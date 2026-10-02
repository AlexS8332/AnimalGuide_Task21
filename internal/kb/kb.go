// Package kb — база знаний справочника: чанки документов корпуса, индекс с
// эмбеддингами в SQLite и поиск по нему (вектором или BM25).
//
// Индекс — пересобираемый артефакт: он живёт в отдельном файле kb.db
// (компонент миграций "kb" общего internal/db), а не в trivia.db демона и не
// в git. Источник истины — корпус (internal/corpus).
//
// Поиск — полный перебор косинуса в памяти: тысячи чанков × 768 измерений —
// миллисекунды, FAISS не нужен (и требует cgo). Если эмбеддер недоступен или
// индекс построен другой моделью, поиск откатывается на BM25 (FTS5,
// токенизатор trigram) и честно говорит об этом в SearchInfo.
package kb

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/AlexS8332/AnimalGuide_Task21/internal/corpus"
	"github.com/AlexS8332/AnimalGuide_Task21/internal/embed"
)

// ErrNotImplemented — заглушка контракта.
var ErrNotImplemented = errors.New("не реализовано")

// ErrNoIndex — индекса с таким id в базе нет.
var ErrNoIndex = errors.New("индекса нет")

// Strategy — стратегия чанкинга; она же id индекса в базе (один индекс на
// стратегию: пересборка заменяет прежний).
type Strategy string

const (
	// Fixed — окно фиксированного размера с перекрытием по сплошному тексту
	// документа (Doc.Text), без оглядки на разделы; раздел чанка — тот, где
	// он начался.
	Fixed Strategy = "fixed"
	// Structure — граница по заголовкам: собственное тело раздела — чанк;
	// длиннее Max — режется по абзацам (затем по предложениям), короче Min —
	// склеивается с соседом того же родителя.
	Structure Strategy = "structure"
)

// Params — параметры стратегии, символы (руны).
type Params struct {
	Size    int `json:"size,omitempty"`    // fixed
	Overlap int `json:"overlap,omitempty"` // fixed
	Max     int `json:"max,omitempty"`     // structure
	Min     int `json:"min,omitempty"`     // structure
}

// Стартовые параметры. У fixed размер по умолчанию — медиана длины
// структурных чанков (kb index -strategy all считает её сам), чтобы
// сравнивались границы, а не размер; перекрытие — 15 % размера.
const (
	DefaultMax        = 1200
	DefaultMin        = 200
	DefaultSize       = 800
	DefaultOverlapPct = 15
)

// Chunk — фрагмент документа с метаданными.
type Chunk struct {
	// ID — "<doc_id>/<strategy>/<ord:03>": "manul/structure/004".
	ID       string   `json:"chunk_id"`
	DocID    string   `json:"doc_id"`
	Source   string   `json:"source"`
	Title    string   `json:"title"`
	Section  string   `json:"section"`      // последний элемент Path или corpus.IntroTitle
	Path     []string `json:"section_path"` // ["Образ жизни", "Питание"]
	Strategy Strategy `json:"strategy"`
	Ord      int      `json:"ord"`
	// Start, End — смещения в рунах в corpus.Doc.Text().
	Start int `json:"start"`
	End   int `json:"end"`
	// Text — сам фрагмент (то, что видит модель и цитирует ответ).
	Text string `json:"text"`
	// Mixed — чанк захватил текст двух и более разделов (у fixed бывает,
	// у structure — нет по построению).
	Mixed  bool   `json:"mixed,omitempty"`
	Tokens int    `json:"tokens"`
	SHA    string `json:"text_sha"`
	URL    string `json:"url,omitempty"`
	RevID  int64  `json:"revid,omitempty"`
}

// EmbedText — что уходит эмбеддеру: «Заголовок › Путь раздела» и текст.
// Заголовок в тексте эмбеддинга помогает найти «питание манула», когда в
// самом абзаце слово «манул» не встречается.
func (c Chunk) EmbedText() string { return "" }

// Chunker — стратегия чанкинга.
type Chunker interface {
	Strategy() Strategy
	Params() Params
	Split(d corpus.Doc) []Chunk
}

// NewFixed и NewStructure — стратегии с параметрами (0 → умолчания).
func NewFixed(size, overlap int) Chunker { return nil }
func NewStructure(max, min int) Chunker  { return nil }

// IndexInfo — индекс в базе.
type IndexInfo struct {
	ID        string    `json:"index_id"` // = string(Strategy)
	Strategy  Strategy  `json:"strategy"`
	Params    Params    `json:"params"`
	Embedder  string    `json:"embedder"` // embed.Embedder.Model()
	Dims      int       `json:"dims"`
	CorpusSHA string    `json:"corpus_sha"`
	Chunks    int       `json:"chunks"`
	Tokens    int       `json:"tokens"`
	BuiltAt   time.Time `json:"built_at"`
	Seconds   float64   `json:"seconds"`
	// MinScore — порог релевантности (калибруется в v23); 0 — не задан.
	MinScore float64 `json:"min_score,omitempty"`
}

// DocInfo — документ в базе (без текста).
type DocInfo struct {
	ID      string  `json:"doc_id"`
	Source  string  `json:"source"`
	Title   string  `json:"title"`
	URL     string  `json:"url"`
	RevID   int64   `json:"revid,omitempty"`
	License string  `json:"license"`
	Chars   int     `json:"chars"`
	Pages   float64 `json:"pages"`
	SHA256  string  `json:"sha256"`
}

// Store — kb.db. Таблицы (шаг миграции 1): kb_meta (corpus_sha, манифест),
// kb_docs (doc JSON целиком), kb_indexes, kb_chunks (метаданные, текст,
// vec BLOB float32 LE), kb_embed_cache, kb_fts (FTS5, trigram, по kb_chunks),
// kb_reports (последний отчёт сравнения, JSON).
type Store struct {
	db *sql.DB
}

// Open открывает (создаёт) kb.db и применяет миграции компонента "kb".
func Open(ctx context.Context, path string) (*Store, error) { return nil, ErrNotImplemented }
func (s *Store) Close() error                               { return nil }

// PutCorpus заменяет документы базы снимком корпуса (одной транзакцией).
func (s *Store) PutCorpus(ctx context.Context, docs []corpus.Doc, m corpus.Manifest) error {
	return ErrNotImplemented
}

// Manifest — манифест корпуса, из которого собрана база.
func (s *Store) Manifest(ctx context.Context) (corpus.Manifest, error) {
	return corpus.Manifest{}, ErrNotImplemented
}
func (s *Store) Docs(ctx context.Context) ([]DocInfo, error) { return nil, ErrNotImplemented }
func (s *Store) Doc(ctx context.Context, id string) (corpus.Doc, error) {
	return corpus.Doc{}, ErrNotImplemented
}

// Progress — ход индексации: сколько чанков закодировано из скольких.
type Progress func(done, total int)

// Build режет документы базы стратегией, кодирует чанки (через кэш
// kb_embed_cache) и заменяет индекс этой стратегии одной транзакцией.
// emb == nil — индекс без векторов (только BM25).
func (s *Store) Build(ctx context.Context, ch Chunker, emb embed.Embedder, p Progress) (IndexInfo, error) {
	return IndexInfo{}, ErrNotImplemented
}
func (s *Store) Indexes(ctx context.Context) ([]IndexInfo, error) { return nil, ErrNotImplemented }
func (s *Store) Index(ctx context.Context, id string) (IndexInfo, error) {
	return IndexInfo{}, ErrNotImplemented
}

// Chunks — чанки индекса (без векторов); docID пусто — все.
func (s *Store) Chunks(ctx context.Context, indexID, docID string) ([]Chunk, error) {
	return nil, ErrNotImplemented
}
func (s *Store) Chunk(ctx context.Context, chunkID string) (Chunk, error) {
	return Chunk{}, ErrNotImplemented
}

// GetVec, PutVec — embed.Cache.
func (s *Store) GetVec(ctx context.Context, model, sha string) ([]float32, bool, error) {
	return nil, false, ErrNotImplemented
}
func (s *Store) PutVec(ctx context.Context, model, sha string, v []float32) error {
	return ErrNotImplemented
}

// Mode — как найдено.
type Mode string

const (
	Dense Mode = "dense"
	BM25  Mode = "bm25"
)

// Hit — найденный чанк. Score — косинус (dense) или нормированный BM25
// (bm25: 1 у лучшего, доли у остальных; у BM25 своя шкала, порог по ней
// отдельный).
type Hit struct {
	Chunk
	Score float64 `json:"score"`
	Rank  int     `json:"rank"` // с 1
}

// SearchInfo — как прошёл поиск. Fallback — почему не dense (эмбеддер
// недоступен, индекс другой модели, индекс без векторов); пусто — dense.
type SearchInfo struct {
	Index    string  `json:"index"`
	Mode     Mode    `json:"mode"`
	Fallback string  `json:"fallback,omitempty"`
	Embedder string  `json:"embedder,omitempty"`
	Millis   float64 `json:"ms"`
}

// SearchOptions — параметры поиска. Mode пусто — dense с откатом на BM25.
type SearchOptions struct {
	Index string
	K     int // 0 → 5
	Mode  Mode
}

// Searcher — поиск по индексам базы. Векторы индекса грузятся в память при
// первом поиске по нему и перечитываются, если индекс пересобран (BuiltAt).
type Searcher struct {
	Store *Store
	// Embedder — для векторов вопроса; nil — только BM25.
	Embedder embed.Embedder
}

func (s *Searcher) Search(ctx context.Context, query string, o SearchOptions) ([]Hit, SearchInfo, error) {
	return nil, SearchInfo{}, ErrNotImplemented
}
