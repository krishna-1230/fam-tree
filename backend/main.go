package main

import (
	"log"
	"os"
	"strings"

	"famtre-backend/db"
	"famtre-backend/routes"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, relying on environment variables.")
	}

	// Initialize DB
	db.ConnectDB()

	// Initialize Gin
	r := gin.Default()

	// CORS config
	config := cors.DefaultConfig()
	allowedOrigins := []string{"http://localhost:3000", "http://127.0.0.1:3000"}
	if envOrigins := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS")); envOrigins != "" {
		allowedOrigins = allowedOrigins[:0]
		for _, origin := range strings.Split(envOrigins, ",") {
			trimmed := strings.TrimSpace(origin)
			if trimmed != "" {
				allowedOrigins = append(allowedOrigins, trimmed)
			}
		}
	}
	config.AllowOrigins = allowedOrigins
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	// Setup Routes
	routes.SetupRoutes(r)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	log.Printf("Server running on port %s", port)
	r.Run(":" + port)
}
