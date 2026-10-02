package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/AlexS8332/AnimalGuide_Task21/internal/kb"
)

func init() {
	register("eval", "сравнить стратегии на контрольных вопросах: отчёт markdown (и JSON)", runEval)
}

func runEval(ctx context.Context, args []string, out, errOut io.Writer) int {
	fs := newFlagSet("eval", "[флаги]", errOut)
	dbPath := fs.String("db", defaultDB, "файл базы знаний")
	questions := fs.String("questions", "eval/questions.json", "контрольные вопросы")
	mdPath := fs.String("out", "examples/kb/chunking.md", "куда записать отчёт markdown (пусто — не писать)")
	jsonPath := fs.String("json", "", "куда записать отчёт JSON (пусто — не писать)")
	bm25 := fs.Bool("bm25", false, "добавить справочные строки BM25")
	budget := fs.Int("budget", kb.DefaultBudget, "бюджет токенов топа для recall при одинаковом объёме")
	which := embedderFlag(fs)
	if code := parseFlags(fs, args); code >= 0 {
		return code
	}
	qs, err := kb.LoadQuestions(*questions)
	if err != nil {
		fmt.Fprintln(errOut, "ошибка:", err)
		return exitUsage
	}
	st, err := openExisting(ctx, *dbPath)
	if err != nil {
		fmt.Fprintln(errOut, "ошибка:", err)
		return exitFailed
	}
	defer st.Close()
	emb, err := pickEmbedder(ctx, *which, errOut)
	if err != nil {
		fmt.Fprintln(errOut, "ошибка:", err)
		return exitUsage
	}
	o := kb.CompareOptions{Budget: *budget}
	if *bm25 {
		o.Mode = kb.BM25
	}
	r, err := kb.Compare(ctx, &kb.Searcher{Store: st, Embedder: emb}, qs, o)
	if err != nil {
		fmt.Fprintln(errOut, "ошибка:", err)
		return exitFailed
	}
	for _, line := range r.Conclusion {
		fmt.Fprintln(out, "- "+line)
	}
	if *mdPath != "" {
		if err := writeFile(*mdPath, []byte(r.Markdown())); err != nil {
			fmt.Fprintln(errOut, "ошибка:", err)
			return exitFailed
		}
		fmt.Fprintln(out, "Отчёт:", *mdPath)
	}
	if *jsonPath != "" {
		raw, err := json.MarshalIndent(r, "", "  ")
		if err == nil {
			err = writeFile(*jsonPath, append(raw, '\n'))
		}
		if err != nil {
			fmt.Fprintln(errOut, "ошибка:", err)
			return exitFailed
		}
		fmt.Fprintln(out, "JSON:", *jsonPath)
	}
	return exitOK
}

func writeFile(path string, data []byte) error {
	if dir := filepath.Dir(path); dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return os.WriteFile(path, data, 0o644)
}
