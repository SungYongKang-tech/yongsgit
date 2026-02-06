// firebase.js (Realtime Database 전용 - 확정본)

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBJq_da5olhDu1pPz2dIKrb_BOQMyYUcVE",
  authDomain: "work-schedule-b3c4e.firebaseapp.com",

  // ✅ Realtime Database URL (확정)
  databaseURL: "https://work-schedule-b3c4e-default-rtdb.asia-southeast1.firebasedatabase.app",

  projectId: "work-schedule-b3c4e",
  storageBucket: "work-schedule-b3c4e.firebasestorage.app",
  messagingSenderId: "823965422017",
  appId: "1:823965422017:web:ac483b91f8c939e8919f40"
};

// Initialize
export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
