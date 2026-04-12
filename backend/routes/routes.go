package routes

import (
	"famtre-backend/controllers"

	"github.com/gin-gonic/gin"
)

func SetupRoutes(r *gin.Engine) {
	api := r.Group("/api")
	{
		// Persons — search must be registered before :id to avoid conflict
		api.GET("/persons/search", controllers.SearchPersons)
		api.POST("/persons", controllers.CreatePerson)
		api.GET("/persons", controllers.GetAllPersons)
		api.GET("/persons/:id", controllers.GetPerson)
		api.PUT("/persons/:id", controllers.UpdatePerson)
		api.DELETE("/persons/:id", controllers.DeletePerson)

		// Relationships
		api.POST("/relationships", controllers.CreateRelationship)
		api.GET("/relationships", controllers.GetAllRelationships)
		api.GET("/relationships/find", controllers.FindRelationship)
		api.DELETE("/relationships/:id", controllers.DeleteRelationship)

		// Graph
		api.GET("/graph", controllers.GetGraph)
		api.POST("/graph/layout/optimize", controllers.OptimizeGraphLayout)

		// Seed
		api.POST("/seed", controllers.SeedData)
	}
}
