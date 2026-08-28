/* 아빠와 민주 PWA + Firebase Cloud Messaging 통합 Service Worker */
importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBQ2DvuwcyIctktubn7LlfJRP0hHfXfnCU",
  authDomain: "personal-51db3.firebaseapp.com",
  databaseURL: "https://personal-51db3-default-rtdb.firebaseio.com",
  projectId: "personal-51db3",
  storageBucket: "personal-51db3.firebasestorage.app",
  messagingSenderId: "146076749227",
  appId: "1:146076749227:web:a89002fef193ba224816ee"
});

const messaging = firebase.messaging();

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

messaging.onBackgroundMessage(payload => {
  const data = payload?.data || {};

  const title = data.title || "민주가 새 글을 남겼어요";
  const options = {
    body: data.body || "게시판을 확인해 주세요.",
    tag: "dad-minju-board-push",
    renotify: true,
    data: {
      url: new URL("board", self.registration.scope).href
    }
  };

  return self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", event => {
  event.notification.close();

  const targetUrl =
    event.notification?.data?.url ||
    new URL("board", self.registration.scope).href;

  event.waitUntil((async()=>{
    const windows = await clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    for(const client of windows){
      if("focus" in client){
        try{
          await client.navigate(targetUrl);
        }catch(e){}
        return client.focus();
      }
    }

    if(clients.openWindow){
      return clients.openWindow(targetUrl);
    }
  })());
});
