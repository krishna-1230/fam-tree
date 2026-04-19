package db

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var Client *mongo.Client

func ConnectDB() {
	mongoURI := os.Getenv("MONGO_URI")
	if mongoURI == "" {
		mongoURI = "mongodb://localhost:27017"
	}

	clientOptions := options.Client().ApplyURI(mongoURI)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, clientOptions)
	if err != nil {
		log.Fatal("Error connecting to MongoDB: ", err)
	}

	err = client.Ping(ctx, nil)
	if err != nil {
		log.Fatal("Could not ping MongoDB: ", err)
	}

	Client = client
	fmt.Println("Connected to MongoDB!")

	setupIndexes()
}

func GetCollection(collectionName string) *mongo.Collection {
	return Client.Database("famtre").Collection(collectionName)
}

func setupIndexes() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	relationshipsCol := GetCollection("relationships")

	_, err := relationshipsCol.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{
			Keys: bson.D{
				{Key: "from_person_id", Value: 1},
				{Key: "type", Value: 1},
			},
		},
		{
			Keys: bson.D{
				{Key: "to_person_id", Value: 1},
				{Key: "type", Value: 1},
			},
		},
		{
			Keys: bson.D{
				{Key: "from_person_id", Value: 1},
				{Key: "to_person_id", Value: 1},
				{Key: "type", Value: 1},
			},
		},
	})
	if err != nil {
		log.Printf("Failed to create indexes on relationships collection: %v", err)
	} else {
		fmt.Println("Database indexes established.")
	}
}
