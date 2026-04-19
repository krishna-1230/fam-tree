package models

import (
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type RelationshipSource string

const (
	RelationshipSourceExplicit RelationshipSource = "explicit"
	RelationshipSourceInferred RelationshipSource = "inferred"
)

type Relationship struct {
	ID           primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	FromPersonID primitive.ObjectID `bson:"from_person_id" json:"from_person_id" validate:"required"`
	ToPersonID   primitive.ObjectID `bson:"to_person_id" json:"to_person_id" validate:"required"`
	// Types: "father", "mother", "spouse", "sibling"
	Type   string             `bson:"type" json:"type" validate:"required,oneof='father' 'mother' 'spouse' 'sibling'"`
	Source RelationshipSource `bson:"source,omitempty" json:"source,omitempty"`
}
