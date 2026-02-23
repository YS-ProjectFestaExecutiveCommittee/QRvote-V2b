// 【重要】ここにGASのウェブアプリURLを貼り付けてください
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxJ0WBnCHj_L9VkYC7cM97y8JYLo8gJ8vLcAWkMwo5kMma4ZZxnAGQC7SXLCN65YPcI/exec";
// 【重要】GAS側の SECURITY_SALT と完全に一致させてください（本番運用時は難読化を推奨）
const SECURITY_SALT = "810810114514";

document.addEventListener('DOMContentLoaded', async () => {
    const loadingScreen = document.getElementById('loading-screen');
    const successScreen = document.getElementById('success-screen');
    const errorScreen = document.getElementById('error-screen');
    const errorMessage = document.getElementById('error-message');

    // 画面切り替え関数
    const showScreen = (screenId) => {
        [loadingScreen, successScreen, errorScreen].forEach(el => el.classList.add('hidden'));
        document.getElementById(screenId).classList.remove('hidden');
    };

    // 1. Bot対策（ハニーポットの確認）
    // 人間には見えない入力欄に値が入っていればBotとみなして処理を中断
    const honeyPot = document.getElementById('honey-pot').value;
    if (honeyPot !== "") {
        errorMessage.textContent = "不正なアクセスを検知しました。";
        showScreen('error-screen');
        return;
    }

    // 2. URLパラメータからブースIDを取得
    const urlParams = new URLSearchParams(window.location.search);
    const boothId = urlParams.get('booth');

    if (!boothId) {
        errorMessage.textContent = "QRコードの読み取りに失敗しました。ブースIDが見つかりません。";
        showScreen('error-screen');
        return;
    }

    try {
        // 3. 位置情報の取得 (ユーザーに許可を求める)
        const position = await getGeolocation();
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        // 4. 端末情報の取得 (FingerprintJS)
        const fpPromise = FingerprintJS.load();
        const fp = await fpPromise;
        const result = await fp.get();
        const visitorId = result.visitorId;

        // 5. 改ざん防止・リプレイ攻撃防止のためのトークン生成
        const timestamp = Date.now();
        const token = await generateHashToken(visitorId, boothId, timestamp, SECURITY_SALT);

        // 演出用ウェイト
        await new Promise(resolve => setTimeout(resolve, 1500));

        // 6. GASへデータ送信
        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8', 
            },
            body: JSON.stringify({
                boothId: boothId,
                visitorId: visitorId,
                lat: lat,
                lng: lng,
                timestamp: timestamp,
                token: token
            })
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const jsonResponse = await response.json();

        // 7. サーバーからの結果判定
        if (jsonResponse.result === 'success') {
            showScreen('success-screen');
        } else if (jsonResponse.result === 'duplicate') {
            errorMessage.innerHTML = "この端末からは既に投票済みです。<br><span style='font-size:0.8em; color:#666;'>※不正防止のため再投票はできません</span>";
            showScreen('error-screen');
        } else if (jsonResponse.result === 'out_of_area') {
            errorMessage.innerHTML = `イベント会場内からのみ投票可能です。<br><span style='font-size:0.8em; color:#666;'>(誤差: 約${Math.round(jsonResponse.distance)}m)</span>`;
            showScreen('error-screen');
        } else if (jsonResponse.result === 'invalid_token') {
            errorMessage.textContent = "セッションが期限切れ、または無効なリクエストです。QRコードを再度読み込んでください。";
            showScreen('error-screen');
        } else {
            errorMessage.textContent = "システムエラーが発生しました: " + (jsonResponse.message || "不明なエラー");
            showScreen('error-screen');
        }

    } catch (error) {
        console.error('Error:', error);
        if (error.code === 1) { // Geolocation Permission Denied
            errorMessage.innerHTML = "位置情報の取得が許可されていません。<br>端末の設定で位置情報をオンにしてください。";
        } else {
            errorMessage.textContent = "通信エラーが発生しました。電波の良い場所でもう一度お試しください。";
        }
        showScreen('error-screen');
    }
});

// 位置情報を取得するPromise関数
function getGeolocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("お使いのブラウザは位置情報に対応していません。"));
        } else {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            });
        }
    });
}

// Web Crypto APIを使用したSHA-256ハッシュ生成関数
async function generateHashToken(visitorId, boothId, timestamp, salt) {
    const textToHash = visitorId + boothId + timestamp + salt;
    const encoder = new TextEncoder();
    const data = encoder.encode(textToHash);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}
