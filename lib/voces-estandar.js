"use strict";
const BASE = [
  ["Alice", "Xb7hH8MSUJpSbSDYk0k2", "female", "British", "confident"],
  ["Bill", "pqHfZKP75CvOlQylNhV4", "male", "American", "trustworthy"],
  ["Brian", "nPczCjzI2devNBz1zQrb", "male", "American", "deep"],
  ["Callum", "N2lVS1w4EtoT3dr4eOWO", "male", "Transatlantic", "intense"],
  ["Charlie", "IKne3meq5aSn9XLyUdCD", "male", "Australian", "natural"],
  ["Charlotte", "XB0fDUnXU5powFXDhCwa", "female", "Swedish", "seductive"],
  ["Chris", "iP95p4xoKVk53GoZ742B", "male", "American", "casual"],
  ["Daniel", "onwK4e9ZLuTAKqWW03F9", "male", "British", "authoritative"],
  ["Eric", "cjVigY5qzO86Huf0OWal", "male", "American", "friendly"],
  ["George", "JBFqnCBsd6RMkjVDRZzb", "male", "British", "warm"],
  ["Jessica", "cgSgspJ2msm6clMCkdW9", "female", "American", "expressive"],
  ["Laura", "FGY2WhTYpPnrIDTdsKH5", "female", "American", "upbeat"],
  ["Liam", "TX3LPaxmHKxFdv7VOQHJ", "male", "American", "articulate"],
  ["Lily", "pFZP5JQG7iQjIQuC4Bku", "female", "British", "warm"],
  ["Matilda", "XrExE9yKIg1WjnnlVkGX", "female", "American", "friendly"],
  ["Sarah", "EXAVITQu4vr4xnSDxMaL", "female", "American", "soft"],
  ["Will", "bIHbv24MWmeRgasZH58o", "male", "American", "friendly"],
];

const VOCES_ESTANDAR = BASE.map(([nombre, id, genero, acento, estilo]) => ({
  id, nombre, categoria: "premade", genero, acento, edad: "", estilo, descripcion: "", idiomas: [], previewUrl: "", origen: "estandar",
}));

module.exports = { VOCES_ESTANDAR };
