// /pingpong/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDCdDtwMoZTZs5BR6VcO20aA6reOr88Pko",
  authDomain: "koenpingpongmain.firebaseapp.com",
  databaseURL: "https://koenpingpongmain-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "koenpingpongmain",
  storageBucket: "koenpingpongmain.firebasestorage.app",
  messagingSenderId: "127829105136",
  appId: "1:127829105136:web:2b23feb46fd892c82f6535"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);