const admin = require("firebase-admin");

const DATABASE_URL = "https://personal-51db3-default-rtdb.firebaseio.com";
const BOARD_URL = "https://sensational-tulumba-65e97e.netlify.app/personal/minjumoney/board";

function readServiceAccount() {
  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    "";

  if (!raw) {
    throw new Error(
      "Netlify 환경변수 FIREBASE_SERVICE_ACCOUNT_JSON 이 없습니다."
    );
  }

  let text = raw.trim();

  // JSON 원문이 아니라 base64로 저장한 경우도 허용
  if (!text.startsWith("{")) {
    try {
      text = Buffer.from(text, "base64").toString("utf8");
    } catch (_) {}
  }

  const serviceAccount = JSON.parse(text);

  // Netlify 환경변수에서 줄바꿈이 \\n 문자열로 들어온 경우 보정
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  }

  return serviceAccount;
}

function getAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(readServiceAccount()),
      databaseURL: DATABASE_URL
    });
  }
  return admin;
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return response(405, { ok: false, error: "POST only" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const messageId = String(body.messageId || "").trim();

    if (!messageId || /[.#$\[\]\/]/.test(messageId)) {
      return response(400, { ok: false, error: "invalid messageId" });
    }

    const firebase = getAdmin();
    const db = firebase.database();

    const messagePath = `민주용돈/게시판/messages/${messageId}`;
    const messageSnap = await db.ref(messagePath).once("value");
    const message = messageSnap.val();

    if (!message) {
      return response(404, { ok: false, error: "message not found" });
    }

    // 아빠가 작성한 글이면 자기 자신에게 Push를 보내지 않음
    if (message.fromDad === true) {
      return response(200, { ok: true, skipped: "fromDad" });
    }

    const createdAt = Number(message.createdAt || 0);
    if (createdAt && Math.abs(Date.now() - createdAt) > 10 * 60 * 1000) {
      return response(200, { ok: true, skipped: "old message" });
    }

    // 같은 글에 대해 중복 Push 방지
    const sentRef = db.ref(`민주용돈/게시판/pushSent/${messageId}`);
    const sentSnap = await sentRef.once("value");
    if (sentSnap.exists()) {
      return response(200, { ok: true, skipped: "already sent" });
    }

    const tokenSnap = await db.ref("민주용돈/게시판/push/dad/token").once("value");
    const token = String(tokenSnap.val() || "").trim();

    if (!token) {
      return response(409, {
        ok: false,
        error: "dad push token not registered"
      });
    }

    const kind = message.kind === "request" ? "수정요청" : "하고싶은말";
    const text = String(message.text || "").trim().slice(0, 180);

    const messageResult = await firebase.messaging().send({
      token,
      data: {
        title: `민주 · ${kind}`,
        body: text || "새 글이 등록됐어요.",
        url: BOARD_URL
      },
      webpush: {
        headers: {
          Urgency: "high"
        },
        fcmOptions: {
          link: BOARD_URL
        }
      }
    });

    await sentRef.set({
      sentAt: firebase.database.ServerValue.TIMESTAMP,
      fcmMessageId: messageResult
    });

    return response(200, {
      ok: true,
      sent: true,
      messageId,
      fcmMessageId: messageResult
    });
  } catch (err) {
    console.error("send-dad-board-push error", err);
    return response(500, {
      ok: false,
      error: err?.message || String(err)
    });
  }
};
