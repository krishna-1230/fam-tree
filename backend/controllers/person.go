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

func CreatePerson(c *gin.Context) {
var person models.Person
if err := c.ShouldBindJSON(&person); err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
return
}
person.ID = primitive.NewObjectID()
collection := db.GetCollection("persons")
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
result, err := collection.InsertOne(ctx, person)
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create person"})
return
}
c.JSON(http.StatusCreated, gin.H{"id": result.InsertedID, "message": "Person created successfully"})
}

func GetAllPersons(c *gin.Context) {
collection := db.GetCollection("persons")
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()
cursor, err := collection.Find(ctx, bson.M{})
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch persons"})
return
}
defer cursor.Close(ctx)
var persons []models.Person
if err = cursor.All(ctx, &persons); err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse persons"})
return
}
c.JSON(http.StatusOK, persons)
}

func SearchPersons(c *gin.Context) {
q := c.Query("q")
if q == "" {
c.JSON(http.StatusOK, []models.Person{})
return
}
collection := db.GetCollection("persons")
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
cursor, err := collection.Find(ctx, bson.M{
"name": bson.M{"$regex": primitive.Regex{Pattern: q, Options: "i"}},
})
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Search failed"})
return
}
defer cursor.Close(ctx)
var persons []models.Person
if err = cursor.All(ctx, &persons); err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse search results"})
return
}
c.JSON(http.StatusOK, persons)
}

type relEntry struct {
relID    primitive.ObjectID
personID primitive.ObjectID
}

func GetPerson(c *gin.Context) {
idParam := c.Param("id")
personID, err := primitive.ObjectIDFromHex(idParam)
if err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid person ID"})
return
}
personCollection := db.GetCollection("persons")
relCollection := db.GetCollection("relationships")
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()

var person models.Person
if err = personCollection.FindOne(ctx, bson.M{"_id": personID}).Decode(&person); err != nil {
c.JSON(http.StatusNotFound, gin.H{"error": "Person not found"})
return
}
cursor, err := relCollection.Find(ctx, bson.M{
"$or": []bson.M{{"from_person_id": personID}, {"to_person_id": personID}},
})
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

// Semantics: father/mother -> from=parent, to=child  |  spouse/sibling -> symmetric
var parentEntries, childEntries, spouseEntries, siblingEntries []relEntry
for _, rel := range rels {
if rel.FromPersonID == personID {
switch rel.Type {
case "father", "mother":
childEntries = append(childEntries, relEntry{rel.ID, rel.ToPersonID})
case "spouse":
spouseEntries = append(spouseEntries, relEntry{rel.ID, rel.ToPersonID})
case "sibling":
siblingEntries = append(siblingEntries, relEntry{rel.ID, rel.ToPersonID})
}
} else {
switch rel.Type {
case "father", "mother":
parentEntries = append(parentEntries, relEntry{rel.ID, rel.FromPersonID})
case "spouse":
spouseEntries = append(spouseEntries, relEntry{rel.ID, rel.FromPersonID})
case "sibling":
siblingEntries = append(siblingEntries, relEntry{rel.ID, rel.FromPersonID})
}
}
}

c.JSON(http.StatusOK, models.PersonDetailResponse{
Person:   person,
Parents:  fetchRelatedPersons(ctx, personCollection, parentEntries),
Children: fetchRelatedPersons(ctx, personCollection, childEntries),
Spouses:  fetchRelatedPersons(ctx, personCollection, spouseEntries),
Siblings: fetchRelatedPersons(ctx, personCollection, siblingEntries),
})
}

func UpdatePerson(c *gin.Context) {
idParam := c.Param("id")
personID, err := primitive.ObjectIDFromHex(idParam)
if err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid person ID"})
return
}
var body map[string]interface{}
if err := c.ShouldBindJSON(&body); err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
return
}
allowed := map[string]bool{"name": true, "gender": true, "date_of_birth": true, "metadata": true}
set := bson.M{}
for k, v := range body {
if !allowed[k] {
continue
}
if k == "date_of_birth" {
if ds, ok := v.(string); ok && ds != "" {
if t, e := time.Parse(time.RFC3339, ds); e == nil {
set[k] = t; continue
}
if t, e := time.Parse("2006-01-02", ds); e == nil {
set[k] = t; continue
}
}
continue
}
set[k] = v
}
if len(set) == 0 {
c.JSON(http.StatusBadRequest, gin.H{"error": "No valid fields to update"})
return
}
collection := db.GetCollection("persons")
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
result, err := collection.UpdateOne(ctx, bson.M{"_id": personID}, bson.M{"$set": set})
if err != nil {
c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update person"})
return
}
if result.MatchedCount == 0 {
c.JSON(http.StatusNotFound, gin.H{"error": "Person not found"})
return
}
c.JSON(http.StatusOK, gin.H{"message": "Person updated successfully"})
}

func DeletePerson(c *gin.Context) {
idParam := c.Param("id")
personID, err := primitive.ObjectIDFromHex(idParam)
if err != nil {
c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid person ID"})
return
}
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()
personCollection := db.GetCollection("persons")
relCollection := db.GetCollection("relationships")
res, err := personCollection.DeleteOne(ctx, bson.M{"_id": personID})
if err != nil || res.DeletedCount == 0 {
c.JSON(http.StatusNotFound, gin.H{"error": "Person not found or could not be deleted"})
return
}
_, _ = relCollection.DeleteMany(ctx, bson.M{
"$or": []bson.M{{"from_person_id": personID}, {"to_person_id": personID}},
})
c.JSON(http.StatusOK, gin.H{"message": "Person and their relationships deleted"})
}

func fetchRelatedPersons(ctx context.Context, collection *mongo.Collection, entries []relEntry) []models.RelatedPerson {
if len(entries) == 0 {
return []models.RelatedPerson{}
}
ids := make([]primitive.ObjectID, len(entries))
relIDMap := make(map[primitive.ObjectID]primitive.ObjectID, len(entries))
for i, e := range entries {
ids[i] = e.personID
relIDMap[e.personID] = e.relID
}
cursor, err := collection.Find(ctx, bson.M{"_id": bson.M{"$in": ids}})
if err != nil {
return []models.RelatedPerson{}
}
defer cursor.Close(ctx)
var persons []models.Person
if err = cursor.All(ctx, &persons); err != nil {
return []models.RelatedPerson{}
}
result := make([]models.RelatedPerson, 0, len(persons))
for _, p := range persons {
result = append(result, models.RelatedPerson{Person: p, RelationshipID: relIDMap[p.ID]})
}
return result
}
