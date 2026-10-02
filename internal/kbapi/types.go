// Package kbapi — REST окна «База знаний»: корпус, индексы, чанки документа,
// поиск и последний отчёт сравнения стратегий.
//
//	GET /api/kb/info                      InfoView
//	GET /api/kb/docs                      []kb.DocInfo
//	GET /api/kb/docs/{id}?index=structure DocView: текст документа и границы чанков
//	GET /api/kb/search?q=&index=&k=&mode= SearchView (index пусто — оба индекса рядом)
//	GET /api/kb/report                    kb.Report (404 — отчёта ещё нет)
//
// Коды: 400 — неверный запрос; 404 — нет документа, индекса или отчёта;
// 405 — не тот метод; 503 — базы нет (в теле why и hint: как её собрать).
// Всё, что пришло из корпуса, интерфейс выводит как данные (esc), а не
// разметку.
package kbapi

import (
	"net/http"

	"github.com/AlexS8332/AnimalGuide_Task21/internal/corpus"
	"github.com/AlexS8332/AnimalGuide_Task21/internal/embed"
	"github.com/AlexS8332/AnimalGuide_Task21/internal/kb"
	"github.com/AlexS8332/AnimalGuide_Task21/internal/server"
)

// Prefix — раздел API.
const Prefix = "/api/kb/"

// HintNoBase — что делать, если базы нет.
const HintNoBase = "соберите базу: go run ./cmd/kb index -strategy all (корпус — каталог corpus/, " +
	"эмбеддер — uv run embedder/server.py; без него индекс соберётся только для BM25)"

// API — раздел. Searcher == nil — базы нет (kb.db не найдена или не
// открылась; причина — Why).
type API struct {
	Searcher *kb.Searcher
	// Embedder — для статуса в InfoView; может быть nil.
	Embedder *embed.HTTP
	Path     string // путь к kb.db, для подсказок
	Why      string
}

// InfoView — GET info.
type InfoView struct {
	OK       bool            `json:"ok"`
	Path     string          `json:"path"`
	Why      string          `json:"why,omitempty"`
	Hint     string          `json:"hint,omitempty"`
	Manifest corpus.Manifest `json:"manifest"`
	Docs     int             `json:"docs"`
	Pages    float64         `json:"pages"`
	Indexes  []kb.IndexInfo  `json:"indexes"`
	Embedder embed.Status    `json:"embedder"`
	Report   bool            `json:"report"` // есть сохранённый отчёт
}

// DocView — GET docs/{id}: документ, его канонический текст и чанки
// индекса (без текста — границы по Start/End в Text).
type DocView struct {
	Doc    kb.DocInfo `json:"doc"`
	Text   string     `json:"text"`
	Index  string     `json:"index"`
	Chunks []kb.Chunk `json:"chunks"`
}

// SearchView — GET search: по результату на каждый запрошенный индекс.
type SearchView struct {
	Query   string         `json:"query"`
	Results []SearchResult `json:"results"`
}

// SearchResult — выдача одного индекса.
type SearchResult struct {
	Info  kb.SearchInfo `json:"info"`
	Hits  []kb.Hit      `json:"hits"`
	Error string        `json:"error,omitempty"`
}

// Extension — раздел для server.New.
func (a *API) Extension() []server.Extension {
	return []server.Extension{{Prefix: Prefix, Handler: http.HandlerFunc(a.handle)}}
}

func (a *API) handle(w http.ResponseWriter, r *http.Request) {
	server.WriteJSON(w, http.StatusNotImplemented, map[string]string{"error": "не реализовано"})
}
