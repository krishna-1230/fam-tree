package controllers

import (
	"context"
	"net/http"
	"time"

	"famtre-backend/db"
	"famtre-backend/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

func isCyclic(ctx context.Context, startNode, endNode primitive.ObjectID) bool {
	// Returns true if there is a path from endNode to startNode via father/mother relations.
	if startNode == endNode {
		return true
	}

	collection := db.GetCollection("relationships")
	queue := []primitive.ObjectID{endNode}
	visited := map[primitive.ObjectID]bool{endNode: true}

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]

		if curr == startNode {
			return true
		}

		cursor, err := collection.Find(ctx, bson.M{
			"from_person_id": curr,
			"type":           bson.M{"$in": []string{"father", "mother"}},
		})
		if err != nil {
			continue
		}

		var rels []models.Relationship
		if err = cursor.All(ctx, &rels); err != nil {
			continue
		}

		for _, r := range rels {
			if !visited[r.ToPersonID] {
				visited[r.ToPersonID] = true
				queue = append(queue, r.ToPersonID)
			}
		}
	}
	return false
}

func CreateRelationship(c *gin.Context) {
	var rel models.Relationship
	if err := c.ShouldBindJSON(&rel); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if rel.FromPersonID == rel.ToPersonID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Person cannot have a relationship with themselves"})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	personCollection := db.GetCollection("persons")
	fromCount, err := personCollection.CountDocuments(ctx, bson.M{"_id": rel.FromPersonID})
	if err != nil || fromCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "From person not found"})
		return
	}
	toCount, err := personCollection.CountDocuments(ctx, bson.M{"_id": rel.ToPersonID})
	if err != nil || toCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "To person not found"})
		return
	}

	collection := db.GetCollection("relationships")
	count, err := collection.CountDocuments(ctx, bson.M{
		"from_person_id": rel.FromPersonID,
		"to_person_id":   rel.ToPersonID,
		"type":           rel.Type,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error checking for duplicate relationship"})
		return
	}
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "This relationship already exists"})
		return
	}
	if rel.Type == "spouse" {
		rev, err := collection.CountDocuments(ctx, bson.M{
			"from_person_id": rel.ToPersonID,
			"to_person_id":   rel.FromPersonID,
			"type":           "spouse",
		})
		if err == nil && rev > 0 {
			c.JSON(http.StatusConflict, gin.H{"error": "Spouse relationship already exists"})
			return
		}
	}

	if rel.Type == "father" || rel.Type == "mother" {
		if isCyclic(ctx, rel.FromPersonID, rel.ToPersonID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "This relationship creates an impossible cycle"})
			return
		}
	}

	rel.ID = primitive.NewObjectID()
	_, err = collection.InsertOne(ctx, rel)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create relationship"})
		return
	}

	// ── Auto-create implied relationships ──────────────────────
	autoCreateImpliedRelationships(ctx, collection, rel)

	c.JSON(http.StatusCreated, rel)
}

func GetAllRelationships(c *gin.Context) {
	collection := db.GetCollection("relationships")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cursor, err := collection.Find(ctx, bson.M{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch relationships"})
		return
	}
	defer cursor.Close(ctx)
	var rels []models.Relationship
	if err = cursor.All(ctx, &rels); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse relationships"})
		return
	}
	c.JSON(http.StatusOK, rels)
}

func DeleteRelationship(c *gin.Context) {
	idParam := c.Param("id")
	relID, err := primitive.ObjectIDFromHex(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid relationship ID"})
		return
	}
	collection := db.GetCollection("relationships")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := collection.DeleteOne(ctx, bson.M{"_id": relID})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete relationship"})
		return
	}
	if result.DeletedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Relationship not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Relationship deleted successfully"})
}

// FindRelationship finds a relationship between two persons by their IDs and optional type.
func FindRelationship(c *gin.Context) {
	fromID := c.Query("from")
	toID := c.Query("to")
	relType := c.Query("type")

	if fromID == "" || toID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "from and to query parameters are required"})
		return
	}

	fromObjID, err := primitive.ObjectIDFromHex(fromID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid from ID"})
		return
	}
	toObjID, err := primitive.ObjectIDFromHex(toID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid to ID"})
		return
	}

	collection := db.GetCollection("relationships")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Build filter: check both directions for symmetric types
	orFilters := []bson.M{
		{"from_person_id": fromObjID, "to_person_id": toObjID},
		{"from_person_id": toObjID, "to_person_id": fromObjID},
	}
	filter := bson.M{"$or": orFilters}
	if relType != "" {
		filter["type"] = relType
	}

	cursor, err := collection.Find(ctx, filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to search relationships"})
		return
	}
	defer cursor.Close(ctx)

	var rels []models.Relationship
	if err = cursor.All(ctx, &rels); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse relationships"})
		return
	}

	c.JSON(http.StatusOK, rels)
}

// ── Auto-create implied relationships ──────────────────────────────────

// insertIfMissing inserts a relationship only if no equivalent exists (checks both directions for symmetric types).
func insertIfMissing(ctx context.Context, col *mongo.Collection, from, to primitive.ObjectID, relType string) {
	if from == to {
		return
	}
	// Check forward
	n, _ := col.CountDocuments(ctx, bson.M{"from_person_id": from, "to_person_id": to, "type": relType})
	if n > 0 {
		return
	}
	// For symmetric types, also check reverse
	if relType == "spouse" || relType == "sibling" {
		r, _ := col.CountDocuments(ctx, bson.M{"from_person_id": to, "to_person_id": from, "type": relType})
		if r > 0 {
			return
		}
	}
	_, _ = col.InsertOne(ctx, models.Relationship{
		ID:           primitive.NewObjectID(),
		FromPersonID: from,
		ToPersonID:   to,
		Type:         relType,
	})
}

func autoCreateImpliedRelationships(ctx context.Context, col *mongo.Collection, rel models.Relationship) {
	switch rel.Type {

	case "father", "mother":
		// rel: parent(from) -> child(to)
		parentID := rel.FromPersonID
		childID := rel.ToPersonID

		// 1. If child already has another parent, auto-create spouse between the two parents
		var existingParentRels []models.Relationship
		cursor, err := col.Find(ctx, bson.M{
			"to_person_id": childID,
			"type":         bson.M{"$in": []string{"father", "mother"}},
		})
		if err == nil {
			_ = cursor.All(ctx, &existingParentRels)
			cursor.Close(ctx)
		}
		for _, pr := range existingParentRels {
			if pr.FromPersonID != parentID {
				insertIfMissing(ctx, col, pr.FromPersonID, parentID, "spouse")
			}
		}

		// 2. If parent has a spouse, auto-create the spouse as the other parent of this child
		var spouseRels []models.Relationship
		cursor2, err := col.Find(ctx, bson.M{
			"$or": []bson.M{
				{"from_person_id": parentID, "type": "spouse"},
				{"to_person_id": parentID, "type": "spouse"},
			},
		})
		if err == nil {
			_ = cursor2.All(ctx, &spouseRels)
			cursor2.Close(ctx)
		}
		for _, sr := range spouseRels {
			spouseID := sr.ToPersonID
			if spouseID == parentID {
				spouseID = sr.FromPersonID
			}
			if spouseID == childID {
				continue
			}
			// Determine the other parent's rel type from their gender
			personCollection := db.GetCollection("persons")
			var spousePerson models.Person
			if err := personCollection.FindOne(ctx, bson.M{"_id": spouseID}).Decode(&spousePerson); err == nil {
				otherType := "father"
				if spousePerson.Gender == "female" {
					otherType = "mother"
				}
				insertIfMissing(ctx, col, spouseID, childID, otherType)
			}
		}

		// 3. Share parents among siblings: if parent already has other children, new child becomes sibling
		var otherChildRels []models.Relationship
		cursor3, err := col.Find(ctx, bson.M{
			"from_person_id": parentID,
			"type":           bson.M{"$in": []string{"father", "mother"}},
			"to_person_id":   bson.M{"$ne": childID},
		})
		if err == nil {
			_ = cursor3.All(ctx, &otherChildRels)
			cursor3.Close(ctx)
		}
		for _, ocr := range otherChildRels {
			insertIfMissing(ctx, col, childID, ocr.ToPersonID, "sibling")
		}

	case "spouse":
		// rel: person A <-> person B as spouses
		aID := rel.FromPersonID
		bID := rel.ToPersonID

		// If A has children, B should also be their parent (and vice versa)
		for _, spouseID := range []primitive.ObjectID{aID, bID} {
			otherSpouseID := bID
			if spouseID == bID {
				otherSpouseID = aID
			}

			var childRels []models.Relationship
			cursor, err := col.Find(ctx, bson.M{
				"from_person_id": spouseID,
				"type":           bson.M{"$in": []string{"father", "mother"}},
			})
			if err == nil {
				_ = cursor.All(ctx, &childRels)
				cursor.Close(ctx)
			}
			for _, cr := range childRels {
				childID := cr.ToPersonID
				personCollection := db.GetCollection("persons")
				var otherSpouse models.Person
				if err := personCollection.FindOne(ctx, bson.M{"_id": otherSpouseID}).Decode(&otherSpouse); err == nil {
					otherType := "father"
					if otherSpouse.Gender == "female" {
						otherType = "mother"
					}
					insertIfMissing(ctx, col, otherSpouseID, childID, otherType)
				}
			}
		}

	case "sibling":
		// rel: person A <-> person B as siblings
		aID := rel.FromPersonID
		bID := rel.ToPersonID

		// Share parents: if A has parents, B should also have those parents
		for _, sibID := range []primitive.ObjectID{aID, bID} {
			otherSibID := bID
			if sibID == bID {
				otherSibID = aID
			}

			var parentRels []models.Relationship
			cursor, err := col.Find(ctx, bson.M{
				"to_person_id": sibID,
				"type":         bson.M{"$in": []string{"father", "mother"}},
			})
			if err == nil {
				_ = cursor.All(ctx, &parentRels)
				cursor.Close(ctx)
			}
			for _, pr := range parentRels {
				insertIfMissing(ctx, col, pr.FromPersonID, otherSibID, pr.Type)
			}
		}
	}
}
