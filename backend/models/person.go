package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type Person struct {
	ID          primitive.ObjectID     `bson:"_id,omitempty" json:"id"`
	Name        string                 `bson:"name" json:"name" validate:"required"`
	Gender      string                 `bson:"gender" json:"gender" validate:"oneof='male' 'female' 'other'"`
	DateOfBirth *time.Time             `bson:"date_of_birth,omitempty" json:"date_of_birth,omitempty"`
	Metadata    map[string]interface{} `bson:"metadata,omitempty" json:"metadata,omitempty"`
}

// RelatedPerson is a Person enriched with the ID of the direct relationship
// connecting them to the queried person.
type RelatedPerson struct {
	Person
	RelationshipID     primitive.ObjectID `json:"relationship_id"`
	RelationshipType   string             `json:"relationship_type"`
	RelationshipSource RelationshipSource `json:"relationship_source"`
}

type PersonDetailResponse struct {
	Person
	Parents  []RelatedPerson `json:"parents"`
	Children []RelatedPerson `json:"children"`
	Spouses  []RelatedPerson `json:"spouses"`
	Siblings []RelatedPerson `json:"siblings"`
}
