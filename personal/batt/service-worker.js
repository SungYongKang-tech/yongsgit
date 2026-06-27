const CACHE_NAME = "ebike-battery-v3";
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
const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
"./192icon.png",
"./512icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

messaging.onBackgroundMessage((payload) => {

  console.log("백그라운드 푸시", payload);

  const title =
    payload.notification?.title ||
    "그룹 메시지";

  const body =
    payload.notification?.body ||
    payload.data?.text ||
    "";

  self.registration.showNotification(title, {
    body,
    icon: "/192icon.png",
    badge: "/192icon.png",
    data: payload.data || {}
  });

});

self.addEventListener("notificationclick", (event) => {

  event.notification.close();

  const roomId =
    event.notification?.data?.roomId || "";

  event.waitUntil(

    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((clientList) => {

      for (const client of clientList) {

        if ("focus" in client) {
          return client.focus();
        }

      }

      if (clients.openWindow) {

        return clients.openWindow(
          roomId
            ? `/ride-map(kakaomap).html?roomId=${encodeURIComponent(roomId)}`
            : "/ride-map(kakaomap).html"
        );

      }

    })

  );

});