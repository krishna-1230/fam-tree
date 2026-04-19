package controllers

import (
	"context"
	"sort"
	"strings"

	"famtre-backend/db"
	"famtre-backend/models"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func relationshipSource(rel models.Relationship) models.RelationshipSource {
	if rel.Source == "" {
		return models.RelationshipSourceExplicit
	}
	return rel.Source
}

func normalizeRelationship(rel models.Relationship) models.Relationship {
	rel.Source = relationshipSource(rel)
	if rel.Type == "spouse" || rel.Type == "sibling" {
		if strings.Compare(rel.FromPersonID.Hex(), rel.ToPersonID.Hex()) > 0 {
			rel.FromPersonID, rel.ToPersonID = rel.ToPersonID, rel.FromPersonID
		}
	}
	return rel
}

func relationshipKey(fromID, toID primitive.ObjectID, relType string) string {
	if relType == "spouse" || relType == "sibling" {
		if strings.Compare(fromID.Hex(), toID.Hex()) > 0 {
			fromID, toID = toID, fromID
		}
	}
	return fromID.Hex() + "|" + toID.Hex() + "|" + relType
}

func relationshipRecordKey(rel models.Relationship) string {
	rel = normalizeRelationship(rel)
	return relationshipKey(rel.FromPersonID, rel.ToPersonID, rel.Type)
}

func rebuildInferredRelationships(ctx context.Context) error {
	collection := db.GetCollection("relationships")
	cursor, err := collection.Find(ctx, bson.M{})
	if err != nil {
		return err
	}
	defer cursor.Close(ctx)

	var stored []models.Relationship
	if err = cursor.All(ctx, &stored); err != nil {
		return err
	}

	explicit := make([]models.Relationship, 0, len(stored))
	seenExplicit := make(map[string]primitive.ObjectID, len(stored))
	deleteIDs := make([]primitive.ObjectID, 0)
	updates := make([]mongo.WriteModel, 0)

	for _, current := range stored {
		normalized := normalizeRelationship(current)
		key := relationshipRecordKey(normalized)

		if relationshipSource(current) == models.RelationshipSourceInferred {
			deleteIDs = append(deleteIDs, current.ID)
			continue
		}

		if existingID, exists := seenExplicit[key]; exists {
			if existingID != current.ID {
				deleteIDs = append(deleteIDs, current.ID)
			}
			continue
		}

		seenExplicit[key] = current.ID
		explicit = append(explicit, normalized)

		if current.FromPersonID != normalized.FromPersonID ||
			current.ToPersonID != normalized.ToPersonID ||
			current.Source != normalized.Source {
			updates = append(updates, mongo.NewUpdateOneModel().
				SetFilter(bson.M{"_id": current.ID}).
				SetUpdate(bson.M{"$set": bson.M{
					"from_person_id": normalized.FromPersonID,
					"to_person_id":   normalized.ToPersonID,
					"type":           normalized.Type,
					"source":         normalized.Source,
				}}))
		}
	}

	if len(deleteIDs) > 0 {
		if _, err = collection.DeleteMany(ctx, bson.M{"_id": bson.M{"$in": deleteIDs}}); err != nil {
			return err
		}
	}

	if len(updates) > 0 {
		if _, err = collection.BulkWrite(ctx, updates, options.BulkWrite().SetOrdered(false)); err != nil {
			return err
		}
	}

	if len(explicit) == 0 {
		return nil
	}

	genderByPerson, err := loadPersonGenders(ctx)
	if err != nil {
		return err
	}

	all := append([]models.Relationship(nil), explicit...)
	queue := append([]models.Relationship(nil), explicit...)
	seenAll := make(map[string]struct{}, len(explicit))
	for _, rel := range explicit {
		seenAll[relationshipRecordKey(rel)] = struct{}{}
	}

	inferred := make([]interface{}, 0)
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		for _, candidate := range deriveImpliedRelationships(current, all, genderByPerson) {
			candidate = normalizeRelationship(candidate)
			candidate.Source = models.RelationshipSourceInferred
			if candidate.FromPersonID == candidate.ToPersonID {
				continue
			}

			key := relationshipRecordKey(candidate)
			if _, exists := seenAll[key]; exists {
				continue
			}

			candidate.ID = primitive.NewObjectID()
			seenAll[key] = struct{}{}
			all = append(all, candidate)
			queue = append(queue, candidate)
			inferred = append(inferred, candidate)
		}
	}

	if len(inferred) == 0 {
		return nil
	}

	_, err = collection.InsertMany(ctx, inferred, options.InsertMany().SetOrdered(false))
	return err
}

func loadPersonGenders(ctx context.Context) (map[string]string, error) {
	collection := db.GetCollection("persons")
	cursor, err := collection.Find(ctx, bson.M{})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var persons []models.Person
	if err = cursor.All(ctx, &persons); err != nil {
		return nil, err
	}

	genderByPerson := make(map[string]string, len(persons))
	for _, person := range persons {
		genderByPerson[person.ID.Hex()] = person.Gender
	}
	return genderByPerson, nil
}

func deriveImpliedRelationships(rel models.Relationship, all []models.Relationship, genderByPerson map[string]string) []models.Relationship {
	derived := make([]models.Relationship, 0)

	switch rel.Type {
	case "father", "mother":
		parentID := rel.FromPersonID
		childID := rel.ToPersonID

		for _, parentRel := range parentRelationshipsForChild(all, childID) {
			if parentRel.FromPersonID == parentID {
				continue
			}
			derived = append(derived, models.Relationship{
				FromPersonID: parentRel.FromPersonID,
				ToPersonID:   parentID,
				Type:         "spouse",
			})
		}

		for _, spouseID := range spouseIDsForPerson(all, parentID) {
			if spouseID == childID {
				continue
			}
			derived = append(derived, models.Relationship{
				FromPersonID: spouseID,
				ToPersonID:   childID,
				Type:         parentRelationshipTypeForGender(genderByPerson[spouseID.Hex()], rel.Type),
			})
		}

		for _, childRel := range childRelationshipsForParent(all, parentID) {
			if childRel.ToPersonID == childID {
				continue
			}
			derived = append(derived, models.Relationship{
				FromPersonID: childID,
				ToPersonID:   childRel.ToPersonID,
				Type:         "sibling",
			})
		}

	case "spouse":
		for _, pair := range [][2]primitive.ObjectID{{rel.FromPersonID, rel.ToPersonID}, {rel.ToPersonID, rel.FromPersonID}} {
			spouseID := pair[0]
			otherSpouseID := pair[1]
			for _, childRel := range childRelationshipsForParent(all, spouseID) {
				derived = append(derived, models.Relationship{
					FromPersonID: otherSpouseID,
					ToPersonID:   childRel.ToPersonID,
					Type:         parentRelationshipTypeForGender(genderByPerson[otherSpouseID.Hex()], childRel.Type),
				})
			}
		}

	case "sibling":
		for _, pair := range [][2]primitive.ObjectID{{rel.FromPersonID, rel.ToPersonID}, {rel.ToPersonID, rel.FromPersonID}} {
			siblingID := pair[0]
			otherSiblingID := pair[1]
			for _, parentRel := range parentRelationshipsForChild(all, siblingID) {
				derived = append(derived, models.Relationship{
					FromPersonID: parentRel.FromPersonID,
					ToPersonID:   otherSiblingID,
					Type:         parentRel.Type,
				})
			}
		}
	}

	return derived
}

func parentRelationshipsForChild(all []models.Relationship, childID primitive.ObjectID) []models.Relationship {
	matches := make([]models.Relationship, 0)
	for _, rel := range all {
		if rel.ToPersonID != childID {
			continue
		}
		if rel.Type != "father" && rel.Type != "mother" {
			continue
		}
		matches = append(matches, rel)
	}
	sort.Slice(matches, func(i, j int) bool {
		return matches[i].FromPersonID.Hex() < matches[j].FromPersonID.Hex()
	})
	return matches
}

func childRelationshipsForParent(all []models.Relationship, parentID primitive.ObjectID) []models.Relationship {
	matches := make([]models.Relationship, 0)
	for _, rel := range all {
		if rel.FromPersonID != parentID {
			continue
		}
		if rel.Type != "father" && rel.Type != "mother" {
			continue
		}
		matches = append(matches, rel)
	}
	sort.Slice(matches, func(i, j int) bool {
		return matches[i].ToPersonID.Hex() < matches[j].ToPersonID.Hex()
	})
	return matches
}

func spouseIDsForPerson(all []models.Relationship, personID primitive.ObjectID) []primitive.ObjectID {
	spouses := make([]primitive.ObjectID, 0)
	seen := make(map[primitive.ObjectID]struct{})
	for _, rel := range all {
		if rel.Type != "spouse" {
			continue
		}

		var spouseID primitive.ObjectID
		switch {
		case rel.FromPersonID == personID:
			spouseID = rel.ToPersonID
		case rel.ToPersonID == personID:
			spouseID = rel.FromPersonID
		default:
			continue
		}

		if _, exists := seen[spouseID]; exists {
			continue
		}
		seen[spouseID] = struct{}{}
		spouses = append(spouses, spouseID)
	}
	sort.Slice(spouses, func(i, j int) bool {
		return spouses[i].Hex() < spouses[j].Hex()
	})
	return spouses
}

func parentRelationshipTypeForGender(gender, fallbackType string) string {
	switch gender {
	case "female":
		return "mother"
	case "male":
		return "father"
	default:
		if fallbackType == "mother" {
			return "mother"
		}
		return "father"
	}
}
