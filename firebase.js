// ============================================================================
// Firebase: подключение и инициализация.
// Используем официальный CDN Google (не нужен npm install / сборка проекта).
// ============================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Этот объект не секретный — его можно спокойно держать в открытом коде сайта.
// Реальная защита данных настраивается через Firestore Security Rules (см. README).
const firebaseConfig = {
  apiKey: "AIzaSyBtDK_Oy5x1ICGKNQlITVBSCFtsiWvt9S8",
  authDomain: "histotyegemanager.firebaseapp.com",
  projectId: "histotyegemanager",
  storageBucket: "histotyegemanager.firebasestorage.app",
  messagingSenderId: "989938305972",
  appId: "1:989938305972:web:927ea35e2eadefbc9440e1",
  measurementId: "G-80XD8533H1"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  doc,
  getDoc,
  setDoc
};

// Человекочитаемые тексты ошибок Firebase Auth вместо английских кодов.
export function translateAuthError(code){
  const map = {
    'auth/email-already-in-use': 'Такая почта уже зарегистрирована — попробуй войти вместо регистрации.',
    'auth/invalid-email': 'Похоже, это не похоже на почту. Проверь адрес.',
    'auth/weak-password': 'Пароль слишком короткий — минимум 6 символов.',
    'auth/wrong-password': 'Неверный пароль.',
    'auth/user-not-found': 'Пользователь с такой почтой не найден.',
    'auth/invalid-credential': 'Неверная почта или пароль.',
    'auth/too-many-requests': 'Слишком много попыток. Подожди немного и попробуй снова.',
    'auth/network-request-failed': 'Проблема с интернет-соединением.',
  };
  return map[code] || 'Что-то пошло не так. Попробуй ещё раз.';
}
