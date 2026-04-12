package controllers

import (
	"context"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"famtre-backend/db"
	"famtre-backend/models"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	generationGap = 170.0
	ringBase      = 130.0
	ringStep      = 38.0
)

var goldenAngle = math.Pi * (3 - math.Sqrt(5))

type layoutResult struct {
	Updated int `json:"updated"`
	Total   int `json:"total"`
}

func OptimizeGraphLayout(c *gin.Context) {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	result, err := ensureGraphLayout(ctx, true)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to optimize graph layout"})
		return
	}

	c.JSON(200, gin.H{
		"message": "Graph layout optimized",
		"updated": result.Updated,
		"total":   result.Total,
	})
}

func ensureGraphLayout(ctx context.Context, force bool) (layoutResult, error) {
	persons, rels, err := fetchGraphEntities(ctx)
	if err != nil {
		return layoutResult{}, err
	}
	if len(persons) == 0 {
		return layoutResult{Updated: 0, Total: 0}, nil
	}

	if !force && !hasMissingCoordinates(persons) {
		return layoutResult{Updated: 0, Total: len(persons)}, nil
	}

	positions := computeLayoutPositions(persons, rels)
	updated, err := persistLayoutPositions(ctx, persons, positions)
	if err != nil {
		return layoutResult{}, err
	}

	return layoutResult{Updated: updated, Total: len(persons)}, nil
}

func fetchGraphEntities(ctx context.Context) ([]models.Person, []models.Relationship, error) {
	personCollection := db.GetCollection("persons")
	relCollection := db.GetCollection("relationships")

	pCursor, err := personCollection.Find(ctx, bson.M{})
	if err != nil {
		return nil, nil, err
	}
	defer pCursor.Close(ctx)

	var persons []models.Person
	if err = pCursor.All(ctx, &persons); err != nil {
		return nil, nil, err
	}

	rCursor, err := relCollection.Find(ctx, bson.M{})
	if err != nil {
		return nil, nil, err
	}
	defer rCursor.Close(ctx)

	var rels []models.Relationship
	if err = rCursor.All(ctx, &rels); err != nil {
		return nil, nil, err
	}

	return persons, rels, nil
}

func hasMissingCoordinates(persons []models.Person) bool {
	for _, p := range persons {
		_, _, _, ok := extractCoordinates(p.Metadata)
		if !ok {
			return true
		}
	}
	return false
}

func computeLayoutPositions(persons []models.Person, rels []models.Relationship) map[string][3]float64 {
	personByID := make(map[string]models.Person, len(persons))
	adj := make(map[string]map[string]struct{}, len(persons))
	parentToChildren := map[string][]string{}
	incomingParentCount := map[string]int{}
	sameGenerationPairs := [][2]string{}

	for _, p := range persons {
		id := p.ID.Hex()
		personByID[id] = p
		adj[id] = map[string]struct{}{}
	}

	for _, rel := range rels {
		a := rel.FromPersonID.Hex()
		b := rel.ToPersonID.Hex()
		if a == "" || b == "" {
			continue
		}
		if _, ok := adj[a]; !ok {
			adj[a] = map[string]struct{}{}
		}
		if _, ok := adj[b]; !ok {
			adj[b] = map[string]struct{}{}
		}

		adj[a][b] = struct{}{}
		adj[b][a] = struct{}{}

		switch rel.Type {
		case "father", "mother":
			parentToChildren[a] = append(parentToChildren[a], b)
			incomingParentCount[b]++
		case "spouse", "sibling":
			sameGenerationPairs = append(sameGenerationPairs, [2]string{a, b})
		}
	}

	allIDs := make([]string, 0, len(personByID))
	for id := range personByID {
		allIDs = append(allIDs, id)
	}
	sort.Slice(allIDs, func(i, j int) bool {
		return sortPersonKey(personByID[allIDs[i]]) < sortPersonKey(personByID[allIDs[j]])
	})

	components := findConnectedComponents(allIDs, adj)
	positions := map[string][3]float64{}

	for idx, component := range components {
		if len(component) == 0 {
			continue
		}

		centerX, centerY, centerZ := componentCenter(idx, len(components), len(component))
		generations := computeGenerations(component, personByID, parentToChildren, incomingParentCount, sameGenerationPairs)

		minGen, maxGen := 0, 0
		for i, id := range component {
			g := generations[id]
			if i == 0 {
				minGen, maxGen = g, g
				continue
			}
			if g < minGen {
				minGen = g
			}
			if g > maxGen {
				maxGen = g
			}
		}

		byGeneration := map[int][]string{}
		for _, id := range component {
			g := generations[id]
			byGeneration[g] = append(byGeneration[g], id)
		}

		generationKeys := make([]int, 0, len(byGeneration))
		for g := range byGeneration {
			generationKeys = append(generationKeys, g)
		}
		sort.Ints(generationKeys)

		for _, g := range generationKeys {
			row := byGeneration[g]
			sort.Slice(row, func(i, j int) bool {
				return sortPersonKey(personByID[row[i]]) < sortPersonKey(personByID[row[j]])
			})
		}

		phase := stableUnit(component[0]) * 2 * math.Pi
		centerGeneration := float64(minGen+maxGen) / 2
		generationSpread := float64(maxGen - minGen)

		for _, g := range generationKeys {
			row := byGeneration[g]
			count := len(row)
			if count == 0 {
				continue
			}

			radius := ringBase + float64(count-1)*ringStep + generationSpread*14
			angleStep := 2 * math.Pi
			if count > 1 {
				angleStep = (2 * math.Pi) / float64(count)
			}

			for i, id := range row {
				angle := phase + float64(g)*0.37 + float64(i)*angleStep
				jitter := (stableUnit(id) - 0.5) * 18
				actualRadius := radius + jitter

				x := centerX + math.Cos(angle)*actualRadius
				z := centerZ + math.Sin(angle)*actualRadius
				y := centerY + (float64(g)-centerGeneration)*generationGap

				positions[id] = [3]float64{round2(x), round2(y), round2(z)}
			}
		}
	}

	return positions
}

func findConnectedComponents(allIDs []string, adj map[string]map[string]struct{}) [][]string {
	visited := map[string]bool{}
	components := make([][]string, 0)

	for _, start := range allIDs {
		if visited[start] {
			continue
		}
		queue := []string{start}
		visited[start] = true
		component := make([]string, 0)

		for len(queue) > 0 {
			cur := queue[0]
			queue = queue[1:]
			component = append(component, cur)

			neighbors := make([]string, 0, len(adj[cur]))
			for n := range adj[cur] {
				neighbors = append(neighbors, n)
			}
			sort.Strings(neighbors)
			for _, n := range neighbors {
				if visited[n] {
					continue
				}
				visited[n] = true
				queue = append(queue, n)
			}
		}

		sort.Strings(component)
		components = append(components, component)
	}

	sort.Slice(components, func(i, j int) bool {
		if len(components[i]) == 0 || len(components[j]) == 0 {
			return len(components[i]) > len(components[j])
		}
		if len(components[i]) != len(components[j]) {
			return len(components[i]) > len(components[j])
		}
		return components[i][0] < components[j][0]
	})

	return components
}

func computeGenerations(
	component []string,
	personByID map[string]models.Person,
	parentToChildren map[string][]string,
	incomingParentCount map[string]int,
	sameGenerationPairs [][2]string,
) map[string]int {
	componentSet := map[string]bool{}
	for _, id := range component {
		componentSet[id] = true
	}

	roots := make([]string, 0)
	for _, id := range component {
		if incomingParentCount[id] == 0 {
			roots = append(roots, id)
		}
	}
	sort.Slice(roots, func(i, j int) bool {
		return sortPersonKey(personByID[roots[i]]) < sortPersonKey(personByID[roots[j]])
	})

	if len(roots) == 0 && len(component) > 0 {
		roots = append(roots, component[0])
	}

	generation := map[string]int{}
	queue := make([]string, 0, len(roots))
	for _, root := range roots {
		generation[root] = 0
		queue = append(queue, root)
	}

	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		curGen := generation[cur]

		children := append([]string(nil), parentToChildren[cur]...)
		sort.Strings(children)
		for _, child := range children {
			if !componentSet[child] {
				continue
			}
			nextGen := curGen + 1
			prevGen, seen := generation[child]
			if !seen || nextGen < prevGen {
				generation[child] = nextGen
				queue = append(queue, child)
			}
		}
	}

	for i := 0; i < len(component)*3; i++ {
		changed := false
		for _, pair := range sameGenerationPairs {
			a, b := pair[0], pair[1]
			if !componentSet[a] || !componentSet[b] {
				continue
			}
			ga, oka := generation[a]
			gb, okb := generation[b]

			switch {
			case oka && !okb:
				generation[b] = ga
				changed = true
			case !oka && okb:
				generation[a] = gb
				changed = true
			case oka && okb && ga != gb:
				target := minInt(ga, gb)
				if ga != target {
					generation[a] = target
					changed = true
				}
				if gb != target {
					generation[b] = target
					changed = true
				}
			}
		}
		if !changed {
			break
		}
	}

	for _, id := range component {
		if _, ok := generation[id]; !ok {
			generation[id] = 0
		}
	}

	return generation
}

func componentCenter(index, total, componentSize int) (float64, float64, float64) {
	if total <= 1 {
		return 0, 0, 0
	}

	t := float64(index) + 0.5
	yNorm := 1 - (2*t)/float64(total)
	r := math.Sqrt(math.Max(0, 1-yNorm*yNorm))
	theta := goldenAngle * float64(index)

	spread := 420 + math.Sqrt(float64(componentSize))*45
	x := math.Cos(theta) * r * spread
	z := math.Sin(theta) * r * spread
	y := yNorm * spread * 0.55

	return x, y, z
}

func persistLayoutPositions(ctx context.Context, persons []models.Person, positions map[string][3]float64) (int, error) {
	collection := db.GetCollection("persons")
	writes := make([]mongo.WriteModel, 0, len(persons))

	for _, person := range persons {
		id := person.ID.Hex()
		coords, ok := positions[id]
		if !ok {
			continue
		}

		meta := cloneMetadata(person.Metadata)
		meta["x"] = coords[0]
		meta["y"] = coords[1]
		meta["z"] = coords[2]

		writes = append(writes, mongo.NewUpdateOneModel().
			SetFilter(bson.M{"_id": person.ID}).
			SetUpdate(bson.M{"$set": bson.M{"metadata": meta}}))
	}

	if len(writes) == 0 {
		return 0, nil
	}

	_, err := collection.BulkWrite(ctx, writes, options.BulkWrite().SetOrdered(false))
	if err != nil {
		return 0, err
	}

	return len(writes), nil
}

func cloneMetadata(meta map[string]interface{}) map[string]interface{} {
	if meta == nil {
		return map[string]interface{}{}
	}
	out := make(map[string]interface{}, len(meta)+3)
	for k, v := range meta {
		out[k] = v
	}
	return out
}

func extractCoordinates(meta map[string]interface{}) (float64, float64, float64, bool) {
	if meta == nil {
		return 0, 0, 0, false
	}

	x, okX := toFloat(meta["x"])
	y, okY := toFloat(meta["y"])
	z, okZ := toFloat(meta["z"])
	if !okX || !okY {
		return 0, 0, 0, false
	}
	if !okZ {
		z = 0
	}

	return x, y, z, true
}

func toFloat(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	case uint:
		return float64(n), true
	case uint32:
		return float64(n), true
	case uint64:
		return float64(n), true
	case string:
		value, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		if err != nil {
			return 0, false
		}
		return value, true
	default:
		return 0, false
	}
}

func sortPersonKey(p models.Person) string {
	return strings.ToLower(strings.TrimSpace(p.Name)) + "|" + p.ID.Hex()
}

func stableUnit(input string) float64 {
	const (
		offset = 1469598103934665603
		prime  = 1099511628211
	)

	hash := uint64(offset)
	for i := 0; i < len(input); i++ {
		hash ^= uint64(input[i])
		hash *= prime
	}

	return float64(hash%10000) / 10000.0
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
