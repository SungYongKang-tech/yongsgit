import { db, ref, set } from "./firebase.js";

async function uploadRestaurants() {
  try {
    const response = await fetch("./data/restaurants.json");
    if (!response.ok) {
      throw new Error(`JSON 파일 로드 실패: ${response.status}`);
    }

    const json = await response.json();

    let list = [];

    if (Array.isArray(json)) {
      list = json;
    } else if (Array.isArray(json.restaurants)) {
      list = json.restaurants;
    } else if (json.restaurants && typeof json.restaurants === "object") {
      list = Object.values(json.restaurants);
    } else if (json && typeof json === "object") {
      list = Object.values(json).filter((v) => typeof v === "object");
    }

    if (!list.length) {
      alert("업로드할 식당 데이터가 없습니다. restaurants.json 구조를 확인하세요.");
      console.log("json =", json);
      return;
    }

    const uploadData = {};
    list.forEach((item, index) => {
      const id = item.id ?? index + 1;
      uploadData[id] = {
        id,
        name: item.name ?? "",
        category: item.category ?? "",
        subCategory: item.subCategory ?? "",
        tags: Array.isArray(item.tags) ? item.tags : [],
        baseRating:
          typeof item.baseRating === "number"
            ? item.baseRating
            : typeof item.rating === "number"
            ? item.rating
            : 0,
        mainMenus: Array.isArray(item.mainMenus)
          ? item.mainMenus
          : Array.isArray(item.menu)
          ? item.menu
          : [],
        address: item.address ?? "",
        description: item.description ?? "",
        menuType: item.menuType ?? ""
      };
    });

    await set(ref(db, "restaurants"), uploadData);

    alert(`Firebase 업로드 완료: ${list.length}건`);
    console.log("업로드 완료", uploadData);
  } catch (error) {
    console.error(error);
    alert("업로드 실패: 콘솔을 확인하세요.");
  }
}

window.uploadRestaurants = uploadRestaurants;