import { supabase } from "./supabase";
import { readPendingAvatar, removePendingAvatar } from "./pendingAvatarStore";

const MAX_AVATAR_SIZE = 4 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function getAvatarValidationError(file: File) {
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) return "Utilisez une image PNG, JPG ou WebP.";
  if (file.size > MAX_AVATAR_SIZE) return "La photo doit peser moins de 4 Mo.";
  return null;
}

export async function uploadAvatar(userId: string, file: File) {
  if (!supabase) throw new Error("Supabase n’est pas configuré.");

  const validationError = getAvatarValidationError(file);
  if (validationError) throw new Error(validationError);

  const path = `${userId}/avatar`;
  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: "3600",
    });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  const publicUrl = new URL(data.publicUrl);
  publicUrl.searchParams.set("v", Date.now().toString());

  const { data: updatedProfile, error: profileError } = await supabase
    .from("profiles")
    .update({ photo_url: publicUrl.toString() })
    .eq("id", userId)
    .select("photo_url")
    .single();

  if (profileError) throw profileError;
  if (typeof updatedProfile.photo_url !== "string") {
    throw new Error("La photo a été envoyée, mais le profil n’a pas pu être mis à jour.");
  }
  return updatedProfile.photo_url;
}

export async function uploadPendingAvatar(user: { id: string; email?: string | null }) {
  if (!user.email) return undefined;

  const pendingAvatar = await readPendingAvatar(user.email);
  if (!pendingAvatar) return undefined;

  const file = new File([pendingAvatar.blob], pendingAvatar.fileName, {
    type: pendingAvatar.mimeType,
    lastModified: pendingAvatar.lastModified,
  });
  const photoUrl = await uploadAvatar(user.id, file);
  await removePendingAvatar(user.email);
  return photoUrl;
}
