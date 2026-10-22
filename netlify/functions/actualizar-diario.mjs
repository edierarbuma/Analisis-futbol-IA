// Se ejecuta solo, todos los días a las 9:00 UTC (4:00 am en Colombia, 6:00 am en Argentina, 11:00 en España).
import { getStore } from "@netlify/blobs";
import { actualizarTodo } from "../lib/datos.mjs";

export default async () => {
  const store = getStore("futbol");
  const anterior = await store.get("datos", { type: "json" }).catch(() => null);
  const datos = await actualizarTodo(anterior);
  await store.setJSON("datos", datos);
  console.log("Datos actualizados", datos.actualizado);
};

export const config = { schedule: "0 9 * * *" };
