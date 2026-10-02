package bench

import (
	"context"
	"strings"
	"testing"

	"github.com/AlexS8332/AnimalGuide_Task21/internal/embed"
)

// TestKBTrial — И-9 на настоящем корпусе и hash-эмбеддере: все жёсткие
// проверки проходят, метрики сравнения в отчёте.
func TestKBTrial(t *testing.T) {
	env := &Env{Root: t.TempDir()}
	s := &Stand{env: env, dir: t.TempDir()}
	tr := &KB{CorpusDir: "../../corpus", Questions: "../../eval/questions.json", Embedder: embed.Hash{}}
	r := &Result{ID: tr.ID(), Title: tr.Title()}
	if err := tr.Run(context.Background(), s, r); err != nil {
		t.Fatal(err)
	}
	if r.Count(Fail) != 0 {
		for _, c := range r.Checks {
			t.Logf("%s: %s (%s) %s", c.Status, c.What, c.Got, c.Note)
		}
		t.Fatal("есть проваленные проверки")
	}
	if len(r.Checks) < 9 {
		t.Fatalf("проверок %d", len(r.Checks))
	}
	var whats []string
	for _, c := range r.Checks {
		whats = append(whats, c.What)
	}
	joined := strings.Join(whats, "\n")
	for _, want := range []string{"объём корпуса", "повторы chunk_id", "двух сборок", "чужого раздела", "Verify", "recall@5"} {
		if !strings.Contains(joined, want) {
			t.Errorf("нет проверки %q", want)
		}
	}
	metrics := map[string]bool{}
	for _, m := range r.Metrics {
		metrics[m.What+"|"+m.Lane] = true
	}
	for _, want := range []string{"чанков|structure", "чанков|fixed", "recall@1/3/5, MRR — test|structure dense", "recall@1/3/5, MRR — dev|fixed bm25"} {
		if !metrics[want] {
			t.Errorf("нет метрики %q", want)
		}
	}
	if len(r.Notes) < 3 {
		t.Fatalf("вывод не попал в заметки: %q", r.Notes)
	}
}

// TestKBTrialNoEmbedder — без эмбеддера индекс собирается для BM25, а
// сравнение по recall — «не определено» с причиной.
func TestKBTrialNoEmbedder(t *testing.T) {
	t.Setenv(embed.EnvBaseURL, "http://127.0.0.1:1")
	s := &Stand{env: &Env{}, dir: t.TempDir()}
	tr := &KB{CorpusDir: "../../corpus", Questions: "../../eval/questions.json"}
	r := &Result{}
	if err := tr.Run(context.Background(), s, r); err != nil {
		t.Fatal(err)
	}
	if r.Count(Fail) != 0 || r.Count(Pending) != 1 {
		t.Fatalf("проверки: fail %d, pending %d", r.Count(Fail), r.Count(Pending))
	}
	for _, c := range r.Checks {
		if c.Status == Pending && !strings.Contains(c.Note, "недоступен") {
			t.Fatalf("причина: %q", c.Note)
		}
	}
}

// TestKBTrialBadCorpus — каталога корпуса нет: проверка провалена, а не
// поломка стенда.
func TestKBTrialBadCorpus(t *testing.T) {
	s := &Stand{env: &Env{}, dir: t.TempDir()}
	r := &Result{}
	if err := (&KB{CorpusDir: t.TempDir(), Embedder: embed.Hash{}}).Run(context.Background(), s, r); err != nil {
		t.Fatal(err)
	}
	if r.Verdict() != Fail {
		t.Fatalf("вердикт %s", r.Verdict())
	}
}
