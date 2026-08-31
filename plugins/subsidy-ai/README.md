# 補助金AI

Jグランツの最新公開データと公募要領を参照し、日本の補助金について根拠付きで回答するためのプラグインです。

現在はJグランツMCPラッパーの初期実装を進めています。MVPの範囲とMCPツール契約は `docs/mvp.md` に定義しています。

## 現在利用できるMCPツール

- `hello`: MCPサーバーの疎通確認
- `search_subsidies`: Jグランツ公開APIから補助金候補を検索
- `get_subsidy_detail`: Jグランツ詳細API V2から公募回、詳細、文書メタデータを取得

`search_subsidies` で都道府県を指定した場合は、その地域固有の制度と全国対象制度を統合して返します。検索結果だけで対象可否を断定せず、候補選定後に `get_subsidy_detail` と最新の公募要領を確認してください。

## 社内配布テスト

前提条件:

- 配布対象者がこのGitHubリポジトリを読み取れること
- GitHubの認証がそのPCのGit環境で完了していること
- Codexがインストールされ、`codex` コマンドを実行できること

マーケットプレイスを追加します。

```powershell
codex plugin marketplace add mkisama94/subsidy_ai_plugin --ref main
```

続いて、補助金AIをインストールします。

```powershell
codex plugin add subsidy-ai@subsidy-ai
```

インストール後は、プラグインのツールを確実に読み込むため、新しいタスクを開始してください。

確認用プロンプト:

> 東京都の省エネ関連で、現在受付中の補助金を3件探してください。候補のうち締切が最も近い制度の詳細も確認してください。

合格条件:

- `search_subsidies` が呼び出される
- 地域固有制度と全国対象制度が検索対象になる
- `get_subsidy_detail` が呼び出される
- Jグランツの制度ID、受付期間、公式詳細URLが表示される
- 検索結果だけで申請資格を断定しない
