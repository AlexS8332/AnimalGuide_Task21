// Package embed — эмбеддинги текстов: интерфейс, HTTP-клиент
// OpenAI-совместимого /v1/embeddings, детерминированный подставной эмбеддер
// и кэш векторов.
//
// У DeepSeek эмбеддингов нет. Основной путь — локальный сайдкар
// (embedder/server.py, uv + sentence-transformers) с моделью
// intfloat/multilingual-e5-base; тот же клиент без изменений ходит в Ollama
// и облачные API — меняются только EMBED_BASE_URL, EMBED_MODEL и
// EMBED_API_KEY. Hash — только для тестов: смысла в его векторах нет, зато
// они одинаковы на любой машине и без сети.
package embed

import (
	"context"
	"errors"
)

const (
	// DefaultBaseURL — адрес сайдкара по умолчанию (embedder/server.py).
	DefaultBaseURL = "http://127.0.0.1:8777"
	// DefaultModel — модель по умолчанию: многоязычная, 768 измерений,
	// вход до 512 токенов, нужны префиксы query:/passage:.
	DefaultModel = "intfloat/multilingual-e5-base"
)

// Переменные окружения клиента.
const (
	EnvBaseURL = "EMBED_BASE_URL"
	EnvModel   = "EMBED_MODEL"
	EnvAPIKey  = "EMBED_API_KEY"
)

// Kind — что кодируется: вопрос или фрагмент базы. У моделей e5 это разные
// префиксы, без них качество поиска заметно падает.
type Kind int

const (
	Query Kind = iota
	Passage
)

// ErrNotImplemented — заглушка контракта.
var ErrNotImplemented = errors.New("не реализовано")

// ErrUnavailable — эмбеддер не отвечает (сайдкар не запущен, сеть). Поиск
// по нему откатывается на BM25; ошибка оборачивается с причиной.
var ErrUnavailable = errors.New("эмбеддер недоступен")

// Embedder — источник векторов. Векторы L2-нормированы: скалярное
// произведение равно косинусу.
type Embedder interface {
	// Model — имя модели, как его пишут в индекс: «intfloat/multilingual-e5-base»,
	// «hash-256». Индекс, построенный одной моделью, другой не ищется.
	Model() string
	// Dims — размерность; 0 — ещё неизвестна (HTTP до первого ответа).
	Dims() int
	// Embed кодирует тексты одним или несколькими батчами; порядок
	// векторов — порядок текстов.
	Embed(ctx context.Context, kind Kind, texts []string) ([][]float32, error)
}

// Prefix — префикс текста для модели и вида: у e5 «query: »/«passage: »,
// у остальных пусто. Таблица — данными, по подстроке имени модели.
func Prefix(model string, kind Kind) string { return "" }

// HTTP — клиент OpenAI-совместимого API: POST {BaseURL}/v1/embeddings
// {"model", "input": [...]}, ответ {"data": [{"index", "embedding"}]}.
// Health — GET {BaseURL}/health (сайдкар) с запасным GET /v1/models
// (Ollama, облако).
type HTTP struct {
	BaseURL string
	Name    string // модель
	APIKey  string
	// Batch — сколько текстов в одном запросе; 0 → 32.
	Batch int
}

// FromEnv — клиент по EMBED_BASE_URL / EMBED_MODEL / EMBED_API_KEY с
// умолчаниями DefaultBaseURL / DefaultModel.
func FromEnv() *HTTP { return &HTTP{BaseURL: DefaultBaseURL, Name: DefaultModel} }

func (h *HTTP) Model() string { return h.Name }
func (h *HTTP) Dims() int     { return 0 }
func (h *HTTP) Embed(ctx context.Context, kind Kind, texts []string) ([][]float32, error) {
	return nil, ErrNotImplemented
}

// Status — состояние эмбеддера для интерфейса и стартового вывода.
type Status struct {
	OK     bool   `json:"ok"`
	URL    string `json:"url"`
	Model  string `json:"model"`
	Dims   int    `json:"dims,omitempty"`
	Device string `json:"device,omitempty"`
	Why    string `json:"why,omitempty"`
	Hint   string `json:"hint,omitempty"`
}

// Health спрашивает сайдкар (коротким таймаутом) и не кидает ошибку: всё,
// что пошло не так, — в Status.Why с подсказкой, как запустить сайдкар.
func (h *HTTP) Health(ctx context.Context) Status { return Status{URL: h.BaseURL, Model: h.Name} }

// Hash — подставной детерминированный эмбеддер для тестов: основы слов
// (words.Stems) и символьные триграммы хэшируются в вектор размерности D.
// Общие слова дают близкие векторы, так что поиск в тестах осмыслен.
type Hash struct{ D int }

func (h Hash) Model() string { return "hash-256" }
func (h Hash) Dims() int     { return 256 }
func (h Hash) Embed(ctx context.Context, kind Kind, texts []string) ([][]float32, error) {
	return nil, ErrNotImplemented
}

// Cache — хранилище векторов по (модель, sha256 текста с префиксом).
// Реализует kb.Store (таблица kb_embed_cache).
type Cache interface {
	GetVec(ctx context.Context, model, sha string) ([]float32, bool, error)
	PutVec(ctx context.Context, model, sha string, v []float32) error
}

// Cached — эмбеддер с кэшем: повторная индексация и повторные вопросы не
// ходят в модель, а повторная оценка поиска совпадает побитно.
type Cached struct {
	E Embedder
	C Cache
	// Hits, Misses — счётчики для отчёта.
	Hits, Misses int
}

func (c *Cached) Model() string { return c.E.Model() }
func (c *Cached) Dims() int     { return c.E.Dims() }
func (c *Cached) Embed(ctx context.Context, kind Kind, texts []string) ([][]float32, error) {
	return nil, ErrNotImplemented
}

// Dot — скалярное произведение (для нормированных векторов — косинус).
func Dot(a, b []float32) float32 {
	var s float32
	for i := range a {
		if i < len(b) {
			s += a[i] * b[i]
		}
	}
	return s
}

// Normalize приводит вектор к единичной длине на месте.
func Normalize(v []float32) {}
