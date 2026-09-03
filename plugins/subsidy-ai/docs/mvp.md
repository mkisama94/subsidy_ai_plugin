# MVP定義

## 最初に検証する利用シナリオ

ユーザーが所在地、業種、従業員規模、投資目的などを入力すると、現在応募可能な補助金候補を検索し、選択した補助金の詳細と公募要領を参照して、根拠付きで回答する。

初版は情報取得だけを扱い、申請、資格の確定、採択可能性の断定は行わない。

## 回答に必ず含める情報

- 補助金名とJグランツ補助金ID
- 実施機関、対象地域、受付期間
- 補助率、補助上限、主要な対象要件
- 根拠となるJグランツ詳細ページまたは公募要領
- データ取得日時
- API項目と公募要領の記述が一致しない場合の注意
- 最終判断は実施機関に確認すべき旨

## MCPツール契約

### `search_companies`

法人名と任意の所在地からgBizINFOの法人候補を検索する読み取り専用ツール。

主な入力:

- `name`: 法人名。正式名称を推奨
- `prefecture`: 任意の都道府県
- `city`: 任意の市区町村
- `page`: ページ番号。既定値1
- `limit`: 返却件数。既定値10、最大20

主な出力:

- 法人番号、法人名、所在地、郵便番号、更新日
- `selectionStatus`: `no_match`、`unique`、`ambiguous`
- `requiresSelection`: 複数候補から利用者による選択が必要か
- `mayHaveMore`: 返却上限に達し、次ページに候補が存在する可能性があるか
- `statusAvailability`: 法人状態の値が提供されているか
- 次に行う確認手順

複数候補がある場合は、モデルが一社を推測で選ばず、正式名称や所在地を利用者に確認する。
`mayHaveMore` が `true` の場合は先頭ページだけであることを明示する。`statusAvailability` が `not_provided` の場合、登記中・存続中とは断定しない。

### `search_subsidies`

ユーザー条件から補助金候補を検索する読み取り専用ツール。

主な入力:

- `keyword`: 事業または投資目的を表す語句
- `target_area`: 所在地または事業実施地域
- `industry`: 業種
- `employee_count`: 従業員数
- `accepting_only`: 受付中だけに限定するか。既定値は `true`
- `limit`: 返却件数。既定値10、最大50

主な出力:

- 安定した補助金ID
- 名称、概要、対象地域、受付期間、補助率、補助上限
- Jグランツ詳細URL
- 取得日時
- 適用した検索条件とページング情報

### `get_subsidy_detail`

補助金IDからJグランツ詳細情報を取得する読み取り専用ツール。

主な入力:

- `subsidy_id`: `search_subsidies` が返した補助金ID

主な出力:

- Jグランツ詳細APIの正規化済み項目
- 公募要領、交付要綱、申請様式のメタデータ
- Jグランツ詳細URL
- 取得日時

### `get_company_profile`

13桁の法人番号からgBizINFOの公開法人情報を取得する読み取り専用ツール。APIトークンはCloudflare Secretから読み込み、応答やログへ出力しない。

主な入力:

- `corporate_number`: 13桁の法人番号
- `activity_limit`: 認定情報と過去の補助金情報の最大返却件数。既定値20、最大50

主な出力:

- 法人名、法人種別、本社所在地、郵便番号
- 業種、事業概要、従業員数、資本金
- 業種大分類コードと日本語名称
- 認定情報と過去の補助金情報
- gBizINFOの出典URLと取得日時

未登録・未更新の項目は推測せず、`null` または空配列として返す。

### `evaluate_subsidy_fit_for_company`

法人番号からgBizINFOの企業プロフィールを取得し、Jグランツの補助金詳細と自動照合する読み取り専用ツール。企業情報は保存しない。

主な入力:

- `subsidy_id`: `search_subsidies` が返した補助金ID
- `corporate_number`: gBizINFOで企業を特定する13桁の法人番号
- `business_plans`: 任意の事業計画
- `location`: 利用者が確認した現在の所在地（任意）
- `industry`: 利用者が確認した現在の業種（任意）
- `employee_count`: 利用者が確認した現在の従業員数（任意）
- `capital_yen`: 利用者が確認した現在の資本金（任意）

主な出力:

- 照合に使用した法人情報と更新日
- gBizINFOとJグランツ双方の出典・取得日時
- 照合に使用した各項目の出典（`gbizinfo`、`user_provided`、`missing`）
- gBizINFOと利用者入力の矛盾、および追加確認が必要か
- 所在地の関係: `exact_match`、`compatible`、`conflict`、`unknown`
- 一致、不一致、未確認事項を分離した候補評価

利用者が明示した値は照合時にgBizINFOの値より優先する。ただし、双方の値が異なる場合は矛盾を隠さず返し、モデルは利用者に確認する。利用者入力は保存しない。
都道府県・市区町村だけの入力と、それを含む詳細住所は `compatible` とし、矛盾として扱わない。異なる詳細住所を行政区域が同じという理由だけで一致とは扱わない。

### `evaluate_subsidy_fit`

補助金IDと、その場でユーザーが確認した企業プロフィールを照合する読み取り専用ツール。初期版では企業情報を保存しない。

主な入力:

- `subsidy_id`: `search_subsidies` が返した補助金ID
- `company_profile.location`: 法人または事業者の所在地
- `company_profile.industry`: 主な業種
- `company_profile.employee_count`: 従業員数
- `company_profile.capital_yen`: 資本金
- `company_profile.business_plans`: 設備投資、DX、省エネなどの計画

主な出力:

- `matchedConditions`: 構造化項目上で一致した条件
- `conflictingConditions`: 明示的に一致しない条件
- `unconfirmedConditions`: 公募要領や実施機関への確認が必要な条件
- `missingProfileFields`: 判定に不足している企業情報
- `status`: `strong_candidate`、`needs_confirmation`、`potentially_ineligible`、`insufficient_information`

この出力は候補評価であり、受給資格や採択を保証しない。

### `get_application_guidelines`

補助金IDに紐づく公募要領を取得し、モデルが根拠箇所を確認できる形にする読み取り専用ツール。

主な入力:

- `subsidy_id`: 対象の補助金ID
- `document_type`: 初版は `application_guidelines` のみ

主な出力:

- 文書名、文書ハッシュ、取得日時
- ページ番号を保持した抽出テキスト
- 原本を参照できるURLまたはリソース識別子
- PDF取得・抽出に失敗した場合の明示的なエラー

## 正確性の原則

1. 検索結果だけで対象可否を断定しない。
2. 詳細回答では公募要領を確認する。
3. 根拠箇所にページ番号または節見出しを付ける。
4. 取得日時と公募締切を区別する。
5. 不足情報は推測せず、ユーザーへの確認事項として返す。
6. JグランツAPIと公募要領が矛盾する場合は、公募要領の記載を優先候補として示し、実施機関への確認を促す。
7. 法人名検索で複数候補がある場合は、自動決定せず利用者に確認する。
8. 公的データと利用者入力の出典を分け、矛盾を明示する。
9. 法人状態が提供されていない場合、登記中・存続中とは断定しない。
10. 検索結果が返却上限に達した場合、続きの候補が存在する可能性を明示する。

## MVPの完了条件

- 代表的な検索条件で候補一覧を取得できる。
- 候補から詳細と公募要領を取得できる。
- 回答内の各主要主張を出典へ追跡できる。
- 終了済み公募を「受付中」と誤表示しない。
- API障害、該当なし、PDF抽出失敗を区別して返せる。
- 同じ評価用質問セットで、通常のWeb回答との正確性を比較できる。
