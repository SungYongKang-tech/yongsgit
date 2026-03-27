// firebase.js  (ES Module 전용)
// ⚠️ 반드시 <script type="module"> 에서 import 해서 사용하세요

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

// ✅ Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyCmIxOSP0U2FVmL6oKVGZCgu2lHqSDtH-8",
  authDomain: "koentennis-7528f.firebaseapp.com",
  databaseURL: "https://koentennis-7528f-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "koentennis-7528f",
  storageBucket: "koentennis-7528f.firebasestorage.app",
  messagingSenderId: "406539650062",
  appId: "1:406539650062:web:6378c278ca5978c2a7285f"
};

// ✅ Firebase 초기화
export const app = initializeApp(firebaseConfig);

// ✅ Realtime Database
export const db = getDatabase(app);

// ✅ Authentication
export const auth = getAuth(app);