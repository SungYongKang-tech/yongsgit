// cloudinary.js
// ✅ 여기에 본인 Cloudinary 값 넣으세요
export const CLOUDINARY_CLOUD_NAME = "dqpcvlakz";
export const CLOUDINARY_UNSIGNED_PRESET = "yongs trip";
export const CLOUDINARY_FOLDER = "trip"; // 예: "travel/schedules"

export async function uploadToCloudinary(file) {
  if (!CLOUDINARY_CLOUD_NAME || CLOUDINARY_CLOUD_NAME.includes("여기에")) {
    throw new Error("Cloudinary cloud_name을 설정해 주세요.");
  }
  if (!CLOUDINARY_UNSIGNED_PRESET || CLOUDINARY_UNSIGNED_PRESET.includes("여기에")) {
    throw new Error("Cloudinary unsigned upload preset을 설정해 주세요.");
  }

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CLOUDINARY_UNSIGNED_PRESET);
  if (CLOUDINARY_FOLDER && !CLOUDINARY_FOLDER.includes("여기에")) {
    fd.append("folder", CLOUDINARY_FOLDER);
  }

  const res = await fetch(url, { method: "POST", body: fd });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("Cloudinary 업로드 실패: " + text);
  }
  const data = await res.json();
  return {
    secure_url: data.secure_url,
    public_id: data.public_id,
    original_filename: data.original_filename,
  };
}
