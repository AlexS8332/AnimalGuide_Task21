package kb

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/AlexS8332/AnimalGuide_Task21/internal/embed"
	"github.com/AlexS8332/AnimalGuide_Task21/internal/embed/embedtest"
)

// miniStore — база во временном каталоге с мини-корпусом.
func miniStore(t *testing.T) *Store {
	t.Helper()
	ctx := context.Background()
	st, err := Open(ctx, filepath.Join(t.TempDir(), "kb.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	docs := miniDocs()
	if err := st.PutCorpus(ctx, docs, miniManifest(docs, "sha-1")); err != nil {
		t.Fatal(err)
	}
	return st
}

func TestStoreRoundTrip(t *testing.T) {
	ctx := context.Background()
	st := miniStore(t)
	m, err := st.Manifest(ctx)
	if err != nil || m.CorpusSHA != "sha-1" || len(m.Entries) != 2 {
		t.Fatalf("манифест: %+v, %v", m, err)
	}
	infos, err := st.Docs(ctx)
	if err != nil || len(infos) != 2 || infos[0].ID != "manul" || infos[0].SHA256 != "sha-manul" ||
		infos[0].Chars != miniDocs()[0].Chars() || infos[0].RevID != 7 || infos[1].License == "" {
		t.Fatalf("документы: %+v, %v", infos, err)
	}
	d, err := st.Doc(ctx, "manul")
	if err != nil || d.Text() != miniDocs()[0].Text() {
		t.Fatalf("документ: %v", err)
	}
	if _, err := st.Doc(ctx, "nope"); !errors.Is(err, ErrNoDoc) {
		t.Fatalf("нет документа: %v", err)
	}
	if _, err := st.Index(ctx, "structure"); !errors.Is(err, ErrNoIndex) {
		t.Fatalf("нет индекса: %v", err)
	}
	if _, err := st.Chunks(ctx, "structure", ""); !errors.Is(err, ErrNoIndex) {
		t.Fatalf("чанки несуществующего индекса: %v", err)
	}

	var progress [][2]int
	info, err := st.Build(ctx, NewStructure(300, 80), embed.Hash{}, func(done, total int) {
		progress = append(progress, [2]int{done, total})
	})
	if err != nil {
		t.Fatal(err)
	}
	if info.ID != "structure" || info.Embedder != "hash-256" || info.Dims != 256 || info.CorpusSHA != "sha-1" ||
		info.Chunks == 0 || info.Tokens == 0 || info.BuiltAt.IsZero() || info.Params.Max != 300 {
		t.Fatalf("индекс: %+v", info)
	}
	if len(progress) < 2 || progress[0][0] != 0 || progress[len(progress)-1] != [2]int{info.Chunks, info.Chunks} {
		t.Fatalf("прогресс: %v", progress)
	}
	got, err := st.Index(ctx, "structure")
	if err != nil || !got.BuiltAt.Equal(info.BuiltAt) || got.Params != info.Params || got.Chunks != info.Chunks {
		t.Fatalf("Index: %+v %v", got, err)
	}

	// Чанки из базы — те же, что режет чанкер.
	want := []Chunk{}
	for _, d := range miniDocs() {
		want = append(want, NewStructure(300, 80).Split(d)...)
	}
	chunks, err := st.Chunks(ctx, "structure", "")
	if err != nil || len(chunks) != len(want) {
		t.Fatalf("чанки: %d из %d, %v", len(chunks), len(want), err)
	}
	for i := range want {
		a, b := want[i], chunks[i]
		if a.ID != b.ID || a.Text != b.Text || a.SHA != b.SHA || a.Start != b.Start || a.End != b.End ||
			a.Mixed != b.Mixed || strings.Join(a.Path, "/") != strings.Join(b.Path, "/") || a.Section != b.Section ||
			a.Strategy != b.Strategy || a.Tokens != b.Tokens || a.RevID != b.RevID || a.URL != b.URL {
			t.Fatalf("чанк %d:\n%+v\n%+v", i, a, b)
		}
	}
	one, err := st.Chunks(ctx, "structure", "corsac")
	if err != nil || len(one) != 1 || one[0].DocID != "corsac" {
		t.Fatalf("чанки корсака: %+v %v", one, err)
	}
	c, err := st.Chunk(ctx, want[0].ID)
	if err != nil || c.Text != want[0].Text {
		t.Fatalf("Chunk: %v", err)
	}
	if _, err := st.Chunk(ctx, "nope/structure/000"); !errors.Is(err, ErrNoChunk) {
		t.Fatalf("нет чанка: %v", err)
	}

	// Индекс без векторов.
	fi, err := st.Build(ctx, NewFixed(200, 30), nil, nil)
	if err != nil || fi.Embedder != "" || fi.Dims != 0 {
		t.Fatalf("fixed без векторов: %+v %v", fi, err)
	}
	all, err := st.Indexes(ctx)
	if err != nil || len(all) != 2 || all[0].ID != "structure" || all[1].ID != "fixed" {
		t.Fatalf("индексы: %+v %v", all, err)
	}

	// Пересборка заменяет индекс целиком: чанков ровно столько, сколько в
	// новой сборке.
	if _, err := st.Build(ctx, NewStructure(1000, 100), embed.Hash{}, nil); err != nil {
		t.Fatal(err)
	}
	again, _ := st.Chunks(ctx, "structure", "")
	var n int
	for _, d := range miniDocs() {
		n += len(NewStructure(1000, 100).Split(d))
	}
	if len(again) != n {
		t.Fatalf("после пересборки %d чанков, ждали %d", len(again), n)
	}
	var fts int
	st.db.QueryRow(`SELECT count(*) FROM kb_fts WHERE index_id = 'structure'`).Scan(&fts)
	if fts != n {
		t.Fatalf("в FTS %d строк, ждали %d", fts, n)
	}

	// Другой корпус — прежние индексы удаляются.
	docs := miniDocs()
	if err := st.PutCorpus(ctx, docs, miniManifest(docs, "sha-2")); err != nil {
		t.Fatal(err)
	}
	if all, _ := st.Indexes(ctx); len(all) != 0 {
		t.Fatalf("индексы старого корпуса остались: %+v", all)
	}
}

func TestVecRoundTripAndCache(t *testing.T) {
	ctx := context.Background()
	st := miniStore(t)
	v := []float32{0.5, -1.25, 3e-7, 0}
	if err := st.PutVec(ctx, "m", "abc", v); err != nil {
		t.Fatal(err)
	}
	got, ok, err := st.GetVec(ctx, "m", "abc")
	if err != nil || !ok || len(got) != 4 || got[0] != 0.5 || got[1] != -1.25 || got[2] != 3e-7 {
		t.Fatalf("GetVec: %v %v %v", got, ok, err)
	}
	if _, ok, _ := st.GetVec(ctx, "other", "abc"); ok {
		t.Fatal("кэш другой модели")
	}

	// Вторая сборка того же индекса — без единого обращения к модели.
	first := &embed.Cached{E: embed.Hash{}}
	info, err := st.Build(ctx, NewStructure(300, 80), first, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Misses == 0 || first.Hits != 0 {
		t.Fatalf("первая сборка: hits %d, misses %d", first.Hits, first.Misses)
	}
	second := &embed.Cached{E: embed.Hash{}}
	if _, err := st.Build(ctx, NewStructure(300, 80), second, nil); err != nil {
		t.Fatal(err)
	}
	if second.Misses != 0 || second.Hits != info.Chunks {
		t.Fatalf("вторая сборка: hits %d, misses %d (чанков %d)", second.Hits, second.Misses, info.Chunks)
	}
}

// TestSearch — dense по hash, BM25, откаты с причиной.
func TestSearch(t *testing.T) {
	ctx := context.Background()
	st := miniStore(t)
	if _, err := st.Build(ctx, NewStructure(300, 80), embed.Hash{}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Build(ctx, NewFixed(200, 30), nil, nil); err != nil {
		t.Fatal(err)
	}
	s := &Searcher{Store: st, Embedder: embed.Hash{}}

	hits, info, err := s.Search(ctx, "чем кормится манул: грызуны и пищухи", SearchOptions{Index: "structure"})
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode != Dense || info.Fallback != "" || info.Embedder != "hash-256" || info.Index != "structure" {
		t.Fatalf("info: %+v", info)
	}
	if len(hits) != DefaultK || hits[0].Rank != 1 || !strings.Contains(hits[0].Text, "пищухами") {
		t.Fatalf("dense: %+v", hits)
	}
	for i := 1; i < len(hits); i++ {
		if hits[i].Score > hits[i-1].Score || hits[i].Rank != i+1 {
			t.Fatalf("порядок выдачи: %+v", hits)
		}
	}

	hits, info, err = s.Search(ctx, "корсак весит", SearchOptions{Index: "structure", Mode: BM25, K: 2})
	if err != nil || info.Mode != BM25 || info.Fallback != "" {
		t.Fatalf("bm25: %+v %v", info, err)
	}
	if len(hits) == 0 || hits[0].DocID != "corsac" || hits[0].Score != 1 {
		t.Fatalf("bm25: %+v", hits)
	}
	for _, h := range hits {
		if h.Score <= 0 || h.Score > 1 {
			t.Fatalf("балл BM25 вне (0, 1]: %v", h.Score)
		}
	}
	// Опасные для FTS5 символы и короткие слова не ломают запрос.
	for _, q := range []string{`"манул" OR NEAR(a b) * -кот: ^x`, "а и в", `'; DROP TABLE kb_chunks; --`} {
		if _, info, err := s.Search(ctx, q, SearchOptions{Index: "structure", Mode: BM25}); err != nil || info.Mode != BM25 {
			t.Fatalf("запрос %q: %v", q, err)
		}
	}
	if _, _, err := s.Search(ctx, "манул", SearchOptions{Index: "nope"}); !errors.Is(err, ErrNoIndex) {
		t.Fatalf("нет индекса: %v", err)
	}
	if _, _, err := s.Search(ctx, "манул", SearchOptions{Index: "structure", Mode: "magic"}); err == nil {
		t.Fatal("неизвестный режим без ошибки")
	}

	// Откаты: индекс без векторов, нет эмбеддера, другая модель.
	for _, c := range []struct {
		s     *Searcher
		index string
		why   string
	}{
		{s, "fixed", "без векторов"},
		{&Searcher{Store: st}, "structure", "не задан"},
		{&Searcher{Store: st, Embedder: embed.Hash{D: 64}}, "structure", "hash-64"},
	} {
		hits, info, err := c.s.Search(ctx, "манул пищуха", SearchOptions{Index: c.index})
		if err != nil || info.Mode != BM25 || !strings.Contains(info.Fallback, c.why) || len(hits) == 0 {
			t.Fatalf("откат %s: %+v %v", c.why, info, err)
		}
	}
}

// TestSearchFallbackUnavailable — эмбеддер упал после сборки: поиск идёт
// по BM25 и говорит почему.
func TestSearchFallbackUnavailable(t *testing.T) {
	ctx := context.Background()
	st := miniStore(t)
	fake := embedtest.Server(t)
	h := &embed.HTTP{BaseURL: fake.URL, Name: embed.DefaultModel}
	if _, err := st.Build(ctx, NewStructure(300, 80), h, nil); err != nil {
		t.Fatal(err)
	}
	s := &Searcher{Store: st, Embedder: h}
	if _, info, err := s.Search(ctx, "манул", SearchOptions{Index: "structure"}); err != nil || info.Mode != Dense {
		t.Fatalf("dense через HTTP: %+v %v", info, err)
	}
	// Вопрос с префиксом e5 ушёл в модель.
	in := fake.Inputs()
	if last := in[len(in)-1]; len(last) != 1 || last[0] != "query: манул" {
		t.Fatalf("вход вопроса: %q", last)
	}
	fake.FailWith(503)
	hits, info, err := s.Search(ctx, "пищухи грызуны", SearchOptions{Index: "structure"})
	if err != nil || info.Mode != BM25 || info.Fallback == "" || len(hits) == 0 {
		t.Fatalf("откат при 503: %+v %v", info, err)
	}
	if !strings.Contains(info.Fallback, "недоступен") {
		t.Fatalf("причина отката: %q", info.Fallback)
	}
	// Повторный вопрос берётся из кэша — модель не нужна.
	if _, info, err := s.Search(ctx, "манул", SearchOptions{Index: "structure"}); err != nil || info.Mode != Dense {
		t.Fatalf("кэшированный вопрос: %+v %v", info, err)
	}
}

// TestSearchReloadAndConcurrency — пересборка индекса видна поиску, а
// одновременные поиски не мешают друг другу.
func TestSearchReloadAndConcurrency(t *testing.T) {
	ctx := context.Background()
	st := miniStore(t)
	if _, err := st.Build(ctx, NewStructure(300, 80), embed.Hash{}, nil); err != nil {
		t.Fatal(err)
	}
	s := &Searcher{Store: st, Embedder: embed.Hash{}}
	var wg sync.WaitGroup
	errs := make(chan error, 16)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, _, err := s.Search(ctx, "манул степь добыча", SearchOptions{Index: "structure"}); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	if _, err := st.Build(ctx, NewStructure(2000, 100), embed.Hash{}, nil); err != nil {
		t.Fatal(err)
	}
	hits, _, err := s.Search(ctx, "манул степь добыча", SearchOptions{Index: "structure", K: 50})
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, d := range miniDocs() {
		n += len(NewStructure(2000, 100).Split(d))
	}
	if len(hits) != n {
		t.Fatalf("после пересборки поиск видит %d чанков, в индексе %d", len(hits), n)
	}
}

func TestFTSQuery(t *testing.T) {
	cases := map[string]string{
		"Чем питается манул?":        `"питает" OR "ману"`,
		`"кот" AND NEAR(лиса)`:       `"кот" OR "near" OR "лиса"`,
		"а и в":                      "",
		"Сколько весит снежный барс": `"веси" OR "снежн" OR "барс"`,
		"ёж":                         "",
	}
	for q, want := range cases {
		if got := ftsQuery(q); got != want {
			t.Errorf("ftsQuery(%q) = %s, ждали %s", q, got, want)
		}
	}
}
