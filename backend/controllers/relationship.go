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
)

type createRelationshipRequest struct {
	FromPersonID string `json:"from_person_id" binding:"required"`
	ToPersonID   string `json:"to_person_id" binding:"required"`
	Type         string `json:"type" binding:"required,oneof=father mother spouse sibling"`
}

func isCyclic(ctx context.Context, startNode, endNode primitive.ObjectID) bool {
	if startNode == endNode {
		return true
	}

	collection := db.GetCollection("relationships")
	queue := []primitive.ObjectID{endNode}
	visited := map[primitive.ObjectID]bool{endNode: true}

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		if current == startNode {
			return true
		}

		cursor, err := collection.Find(ctx, bson.M{
			"from_person_id": current,
			"type":           bson.M{"$in": []string{"father", "mother"}},
		})
		if err != nil {
			continue
		}

		var rels []models.Relationship
		if err = cursor.All(ctx, &rels); err != nil {
			cursor.Close(ctx)
			continue
		}
		cursor.Close(ctx)

		for _, rel := range rels {
			if visited[rel.ToPersonID] {
				continue
			}
			visited[rel.ToPersonID] = true
			queue = append(queue, rel.ToPersonID)
		}
	}

	return false
}

func CreateRelationship(c *gin.Context) {
	var req createRelationshipRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fromPersonID, err := primitive.ObjectIDFromHex(req.FromPersonID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid from person ID"})
		return
	}
	toPersonID, err := primitive.ObjectIDFromHex(req.ToPersonID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid to person ID"})
		return
	}

	rel := normalizeRelationship(models.Relationship{
		ID:           primitive.NewObjectID(),
		FromPersonID: fromPersonID,
		ToPersonID:   toPersonID,
		Type:         req.Type,
		Source:       models.RelationshipSourceExplicit,
	})

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

	if rel.Type == "father" || rel.Type == "mother" {
		if isCyclic(ctx, rel.FromPersonID, rel.ToPersonID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "This relationship creates an impossible cycle"})
			return
		}
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

	if _, err = collection.InsertOne(ctx, rel); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create relationship"})
		return
	}

	if err = rebuildInferredRelationships(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Relationship created, but graph inference rebuild failed"})
		return
	}

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

	for index, rel := range rels {
		rels[index] = normalizeRelationship(rel)
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

	var rel models.Relationship
	if err = collection.FindOne(ctx, bson.M{"_id": relID}).Decode(&rel); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Relationship not found"})
		return
	}
	if relationshipSource(rel) == models.RelationshipSourceInferred {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Derived relationships cannot be deleted directly"})
		return
	}

	result, err := collection.DeleteOne(ctx, bson.M{"_id": relID})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete relationship"})
		return
	}
	if result.DeletedCount == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Relationship not found"})
		return
	}

	if err = rebuildInferredRelationships(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Relationship deleted, but graph inference rebuild failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Relationship deleted successfully"})
}

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

	filter := bson.M{
		"$or": []bson.M{
			{"from_person_id": fromObjID, "to_person_id": toObjID},
			{"from_person_id": toObjID, "to_person_id": fromObjID},
		},
	}
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
	if len(rels) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Relationship not found"})
		return
	}

	best := rels[0]
	for _, candidate := range rels[1:] {
		if relationshipSource(best) == models.RelationshipSourceExplicit {
			continue
		}
		if relationshipSource(candidate) == models.RelationshipSourceExplicit {
			best = candidate
		}
	}

	c.JSON(http.StatusOK, normalizeRelationship(best))
}
