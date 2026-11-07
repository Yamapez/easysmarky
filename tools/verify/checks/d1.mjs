// 方向1(安全性・データ保全)の検査。担当が中身を書く。
// 使い方: await openHarness(send, `${URL_HARNESS}?scenario=d1`) で開き、evalJs で状態を読み、check(名前, 条件, 詳細) を呼ぶ。
// 検査が終わったら、次の検査が影響を受けないようにページを開き直す(openHarness をもう一度呼ぶ)。
export async function run(ctx) {}
