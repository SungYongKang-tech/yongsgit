// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAX9JAF_qfHszEsx0YZIPyQ1ygfVm8K8IY",
  authDomain: "gido-645c1.firebaseapp.com",
  databaseURL: "https://gido-645c1-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "gido-645c1",
  storageBucket: "gido-645c1.firebasestorage.app",
  messagingSenderId: "799221874446",
  appId: "1:799221874446:web:e1ff2ceb3f8c573f1f615f"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
