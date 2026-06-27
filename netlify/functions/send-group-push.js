const admin = require("firebase-admin");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

function safeFirebaseKey(value) {
  return String(value || "라이더")
    .trim()
    .replace(/[.#$/\[\]]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 40) || "라이더";
}

function initAdmin() {
  if (admin.apps.length) return admin.app();

  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}"
  );

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://personal-51db3-default-rtdb.firebaseio.com"
  });
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "POST만 허용됩니다." });
  }

  try {
    initAdmin();

    const body = JSON.parse(event.body || "{}");

    const roomId = String(body.roomId || "").trim();
    const senderName = String(body.senderName || "라이더").trim();
    const text = String(body.text || "").trim();

    if (!roomId || !text) {
      return json(400, {
        ok: false,
        error: "roomId 또는 text가 없습니다."
      });
    }

    const senderNameKey = safeFirebaseKey(senderName);

    const snap = await admin
      .database()
      .ref(`rideRooms/${roomId}/pushUsers`)
      .once("value");

    const pushUsers = snap.val() || {};
    const tokens = [];

    Object.entries(pushUsers).forEach(([nameKey, devices]) => {
      if (nameKey === senderNameKey) return;

      Object.values(devices || {}).forEach((device) => {
        if (device?.fcmToken) {
          tokens.push(device.fcmToken);
        }
      });
    });

    const uniqueTokens = [...new Set(tokens)];

    if (uniqueTokens.length === 0) {
      return json(200, {
        ok: true,
        message: "보낼 푸시 토큰이 없습니다.",
        sent: 0
      });
    }

    const messages = uniqueTokens.map((token) => ({
      token,
      notification: {
        title: `${senderName}님의 그룹 메시지`,
        body: text
      },
      data: {
        roomId,
        senderName,
        text,
        type: "groupMessage"
      },
      webpush: {
        notification: {
          title: `${senderName}님의 그룹 메시지`,
          body: text,
          icon: "/192icon.png",
          badge: "/192icon.png"
        }
      }
    }));

    const result = await admin.messaging().sendEach(messages);

    return json(200, {
      ok: true,
      requested: uniqueTokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount
    });

  } catch (err) {
    console.error("send-group-push error:", err);

    return json(500, {
      ok: false,
      error: err.message || "푸시 발송 실패"
    });
  }
};