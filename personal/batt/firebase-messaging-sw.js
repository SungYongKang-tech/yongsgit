importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBQ2DvuwcyIctktubn7LlfJRP0hHfXfnCU",
  authDomain: "personal-51db3.firebaseapp.com",
  databaseURL: "https://personal-51db3-default-rtdb.firebaseio.com",
  projectId: "personal-51db3",
  storageBucket: "personal-51db3.firebasestorage.app",
  messagingSenderId: "146076749227",
  appId: "1:146076749227:web:2043208d688e60504816ee"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "그룹 메시지";
  const body = payload.notification?.body || payload.data?.text || "";

  self.registration.showNotification(title, {
    body,
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: payload.data || {}
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const roomId = event.notification?.data?.roomId || "";
  const url = roomId
    ? `/?roomId=${encodeURIComponent(roomId)}`
    : "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});