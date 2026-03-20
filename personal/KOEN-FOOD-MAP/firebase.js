// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  update,
  remove,
  get
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBuijKPhPdULzPN_v07n5TAYjPn1T8-PEA",
  authDomain: "koen-food-map.firebaseapp.com",
  projectId: "koen-food-map",
  storageBucket: "koen-food-map.firebasestorage.app",
  messagingSenderId: "840903211634",
  appId: "1:840903211634:web:01b61f736b5ca740a360eb",
  databaseURL: "https://koen-food-map-default-rtdb.asia-southeast1.firebasedatabase.app"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, onValue, set, update, remove, get };