import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAV47F8u96UQ_2hf9q2KdtGlXqDXYbThyo",
  authDomain: "lessonswap-26e9b.firebaseapp.com",
  databaseURL: "https://lessonswap-26e9b-default-rtdb.firebaseio.com",
  projectId: "lessonswap-26e9b",
  storageBucket: "lessonswap-26e9b.firebasestorage.app",
  messagingSenderId: "1068278553187",
  appId: "1:1068278553187:web:5b1bc4b61f1c4dc53fb656"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
