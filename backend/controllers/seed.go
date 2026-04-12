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

// SeedData populates the database with 30 family members across 4 generations.
func SeedData(c *gin.Context) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	personCol := db.GetCollection("persons")
	relCol := db.GetCollection("relationships")

	// Check if data already exists
	count, _ := personCol.CountDocuments(ctx, bson.M{})
	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Database already has data. Delete all persons first if you want to reseed."})
		return
	}

	type personDef struct {
		name   string
		gender string
	}

	// ── Generation 1 (Great-grandparents): 4 people ──
	gen1 := []personDef{
		{"Robert Wilson", "male"},      // 0
		{"Margaret Wilson", "female"},  // 1
		{"James Anderson", "male"},     // 2
		{"Dorothy Anderson", "female"}, // 3
	}

	// ── Generation 2 (Grandparents): 8 people ──
	gen2 := []personDef{
		{"William Wilson", "male"},     // 4  - son of 0,1
		{"Elizabeth Taylor", "female"}, // 5  - spouse of 4
		{"Richard Anderson", "male"},   // 6  - son of 2,3
		{"Susan Anderson", "female"},   // 7  - spouse of 6
		{"Thomas Wilson", "male"},      // 8  - son of 0,1
		{"Patricia Moore", "female"},   // 9  - spouse of 8
		{"George Anderson", "male"},    // 10 - son of 2,3
		{"Barbara Davis", "female"},    // 11 - spouse of 10
	}

	// ── Generation 3 (Parents + cousins): 10 people ──
	gen3 := []personDef{
		{"Michael Wilson", "male"},      // 12 - son of 4,5
		{"Jennifer Anderson", "female"}, // 13 - daughter of 6,7, spouse of 12
		{"David Wilson", "male"},        // 14 - son of 4,5
		{"Sarah Wilson", "female"},      // 15 - spouse of 14
		{"Daniel Wilson", "male"},       // 16 - son of 8,9
		{"Emily Moore", "female"},       // 17 - daughter of 8,9
		{"Kevin Anderson", "male"},      // 18 - son of 10,11
		{"Amanda Anderson", "female"},   // 19 - daughter of 10,11
		{"Christopher Clark", "male"},   // 20 - spouse of 17
		{"Jessica Lee", "female"},       // 21 - spouse of 18
	}

	// ── Generation 4 (Children): 8 people ──
	gen4 := []personDef{
		{"Ethan Wilson", "male"},    // 22 - son of 12,13
		{"Olivia Wilson", "female"}, // 23 - daughter of 12,13
		{"Sophia Wilson", "female"}, // 24 - daughter of 12,13
		{"Liam Wilson", "male"},     // 25 - son of 14,15
		{"Emma Wilson", "female"},   // 26 - daughter of 14,15
		{"Noah Clark", "male"},      // 27 - son of 20,17
		{"Ava Anderson", "female"},  // 28 - daughter of 18,21
		{"Lucas Wilson", "male"},    // 29 - son of 12,13
	}

	allDefs := make([]personDef, 0, 30)
	allDefs = append(allDefs, gen1...)
	allDefs = append(allDefs, gen2...)
	allDefs = append(allDefs, gen3...)
	allDefs = append(allDefs, gen4...)

	// Create all persons
	ids := make([]primitive.ObjectID, len(allDefs))
	for i, def := range allDefs {
		id := primitive.NewObjectID()
		ids[i] = id
		_, err := personCol.InsertOne(ctx, models.Person{
			ID:     id,
			Name:   def.name,
			Gender: def.gender,
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create person: " + def.name})
			return
		}
	}

	rel := func(fromIdx, toIdx int, relType string) {
		_, _ = relCol.InsertOne(ctx, models.Relationship{
			ID:           primitive.NewObjectID(),
			FromPersonID: ids[fromIdx],
			ToPersonID:   ids[toIdx],
			Type:         relType,
		})
	}

	// ── Gen 1 spouses ──
	rel(0, 1, "spouse")
	rel(2, 3, "spouse")

	// ── Gen 2: children of gen1 ──
	rel(0, 4, "father")
	rel(1, 4, "mother") // Robert,Margaret -> William
	rel(0, 8, "father")
	rel(1, 8, "mother") // Robert,Margaret -> Thomas
	rel(2, 6, "father")
	rel(3, 6, "mother") // James,Dorothy -> Richard
	rel(2, 10, "father")
	rel(3, 10, "mother") // James,Dorothy -> George

	// Gen 2 spouses
	rel(4, 5, "spouse")
	rel(6, 7, "spouse")
	rel(8, 9, "spouse")
	rel(10, 11, "spouse")

	// Gen 2 siblings
	rel(4, 8, "sibling")  // William <-> Thomas
	rel(6, 10, "sibling") // Richard <-> George

	// ── Gen 3: children of gen2 ──
	rel(4, 12, "father")
	rel(5, 12, "mother") // William,Elizabeth -> Michael
	rel(4, 14, "father")
	rel(5, 14, "mother") // William,Elizabeth -> David
	rel(6, 13, "father")
	rel(7, 13, "mother") // Richard,Susan -> Jennifer
	rel(8, 16, "father")
	rel(9, 16, "mother") // Thomas,Patricia -> Daniel
	rel(8, 17, "father")
	rel(9, 17, "mother") // Thomas,Patricia -> Emily
	rel(10, 18, "father")
	rel(11, 18, "mother") // George,Barbara -> Kevin
	rel(10, 19, "father")
	rel(11, 19, "mother") // George,Barbara -> Amanda

	// Gen 3 spouses
	rel(12, 13, "spouse") // Michael <-> Jennifer
	rel(14, 15, "spouse") // David <-> Sarah
	rel(20, 17, "spouse") // Christopher <-> Emily
	rel(18, 21, "spouse") // Kevin <-> Jessica

	// Gen 3 siblings
	rel(12, 14, "sibling") // Michael <-> David
	rel(16, 17, "sibling") // Daniel <-> Emily
	rel(18, 19, "sibling") // Kevin <-> Amanda

	// ── Gen 4: children of gen3 ──
	rel(12, 22, "father")
	rel(13, 22, "mother") // Michael,Jennifer -> Ethan
	rel(12, 23, "father")
	rel(13, 23, "mother") // Michael,Jennifer -> Olivia
	rel(12, 24, "father")
	rel(13, 24, "mother") // Michael,Jennifer -> Sophia
	rel(12, 29, "father")
	rel(13, 29, "mother") // Michael,Jennifer -> Lucas
	rel(14, 25, "father")
	rel(15, 25, "mother") // David,Sarah -> Liam
	rel(14, 26, "father")
	rel(15, 26, "mother") // David,Sarah -> Emma
	rel(20, 27, "father")
	rel(17, 27, "mother") // Christopher,Emily -> Noah
	rel(18, 28, "father")
	rel(21, 28, "mother") // Kevin,Jessica -> Ava

	// Gen 4 siblings
	rel(22, 23, "sibling") // Ethan <-> Olivia
	rel(22, 24, "sibling") // Ethan <-> Sophia
	rel(22, 29, "sibling") // Ethan <-> Lucas
	rel(23, 24, "sibling") // Olivia <-> Sophia
	rel(23, 29, "sibling") // Olivia <-> Lucas
	rel(24, 29, "sibling") // Sophia <-> Lucas
	rel(25, 26, "sibling") // Liam <-> Emma

	c.JSON(http.StatusCreated, gin.H{
		"message": "Seeded 30 family members across 4 generations",
		"count":   len(allDefs),
	})
}
