package controllers

import (
	"context"
	"net/http"
	"time"

	"famtre-backend/models"

	"github.com/gin-gonic/gin"
)

type GraphResponse struct {
	Nodes []models.Person       `json:"nodes"`
	Links []models.Relationship `json:"links"`
}

func GetGraph(c *gin.Context) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	if _, err := ensureGraphLayout(ctx, false); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to prepare graph layout"})
		return
	}

	persons, rels, err := fetchGraphEntities(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch graph data"})
		return
	}

	c.JSON(http.StatusOK, GraphResponse{
		Nodes: persons,
		Links: rels,
	})
}
