export type StudyCatalogueEntry = { name: string; price: number; category: string }

export const STUDY_CATEGORIES = [
  "Sonography",
  "X-Ray",
  "Blood Test",
  "Pathology",
  "MRI",
  "CT Scan",
  "Cardiology",
  "Other",
] as const

export const STUDY_CATALOGUE: StudyCatalogueEntry[] = [
  // Sonography
  { name: "USG Abdomen",                      price: 700,  category: "Sonography" },
  { name: "USG Pelvis",                        price: 600,  category: "Sonography" },
  { name: "USG Abdomen & Pelvis",              price: 1000, category: "Sonography" },
  { name: "USG Kidney (KUB)",                  price: 700,  category: "Sonography" },
  { name: "USG Thyroid & Neck",                price: 700,  category: "Sonography" },
  { name: "USG Breast (Both)",                 price: 800,  category: "Sonography" },
  { name: "Doppler Study",                     price: 1500, category: "Sonography" },
  { name: "Obstetric USG (1st Trimester)",     price: 700,  category: "Sonography" },
  { name: "Obstetric USG (2nd / 3rd Trim.)",   price: 800,  category: "Sonography" },
  { name: "Fetal Well-Being Profile",          price: 1000, category: "Sonography" },
  { name: "Trans-Vaginal Sonography (TVS)",    price: 800,  category: "Sonography" },
  { name: "USG Guided FNAC",                   price: 1200, category: "Sonography" },
  // X-Ray
  { name: "X-Ray Chest PA",                    price: 300,  category: "X-Ray" },
  { name: "X-Ray Chest AP + LAT",              price: 400,  category: "X-Ray" },
  { name: "X-Ray LS Spine AP + LAT",           price: 500,  category: "X-Ray" },
  { name: "X-Ray Cervical Spine",              price: 500,  category: "X-Ray" },
  { name: "X-Ray Skull AP + LAT",              price: 400,  category: "X-Ray" },
  { name: "X-Ray KUB",                         price: 400,  category: "X-Ray" },
  { name: "X-Ray Knee AP + LAT",               price: 400,  category: "X-Ray" },
  { name: "X-Ray Hip Joint",                   price: 450,  category: "X-Ray" },
  { name: "X-Ray Shoulder",                    price: 400,  category: "X-Ray" },
  { name: "X-Ray Hand / Wrist",                price: 300,  category: "X-Ray" },
  { name: "X-Ray Foot / Ankle",                price: 300,  category: "X-Ray" },
  { name: "X-Ray PNS / Sinus",                 price: 400,  category: "X-Ray" },
  // MRI
  { name: "MRI Brain (Plain)",                 price: 5500, category: "MRI" },
  { name: "MRI Brain with Contrast",           price: 7500, category: "MRI" },
  { name: "MRI Spine – Cervical",              price: 5500, category: "MRI" },
  { name: "MRI Spine – Lumbar",                price: 5500, category: "MRI" },
  { name: "MRI Knee",                          price: 5500, category: "MRI" },
  { name: "MRI Shoulder",                      price: 5500, category: "MRI" },
  { name: "MRI Abdomen",                       price: 7000, category: "MRI" },
  { name: "MRI Pelvis",                        price: 7000, category: "MRI" },
  { name: "MRA Brain",                         price: 8000, category: "MRI" },
  // CT Scan
  { name: "CT Brain (Plain)",                  price: 3500, category: "CT Scan" },
  { name: "CT Brain with Contrast",            price: 5000, category: "CT Scan" },
  { name: "CT Chest (HRCT)",                   price: 4500, category: "CT Scan" },
  { name: "CT Abdomen (Plain)",                price: 4000, category: "CT Scan" },
  { name: "CT Abdomen + Pelvis",               price: 6000, category: "CT Scan" },
  { name: "CT KUB (Urography)",                price: 4500, category: "CT Scan" },
  { name: "CT Spine – Lumbar",                 price: 4500, category: "CT Scan" },
  { name: "CT Angiography",                    price: 9000, category: "CT Scan" },
  // Sonography – additional studies from templates
  { name: "USG Upper Abdomen",                 price: 600,  category: "Sonography" },
  { name: "USG Scrotum",                       price: 700,  category: "Sonography" },
  { name: "USG Chest",                         price: 600,  category: "Sonography" },
  { name: "USG Axilla",                        price: 500,  category: "Sonography" },
  { name: "USG Bladder & Prostate",            price: 600,  category: "Sonography" },
  { name: "USG Inguinal Region",               price: 500,  category: "Sonography" },
  { name: "USG Parotid Gland",                 price: 600,  category: "Sonography" },
  { name: "USG Local Part",                    price: 400,  category: "Sonography" },
  { name: "Follicular Study",                  price: 600,  category: "Sonography" },
  { name: "Carotid Doppler",                   price: 2000, category: "Sonography" },
  { name: "Portal Vein Doppler",               price: 1500, category: "Sonography" },
  { name: "Renal Artery Doppler",              price: 2000, category: "Sonography" },
  { name: "Lower Limb Venous Doppler",         price: 1500, category: "Sonography" },
  { name: "Lower Limb Arterial Doppler",       price: 1800, category: "Sonography" },
  { name: "Upper Limb Doppler",                price: 1500, category: "Sonography" },
  // X-Ray – additional studies from templates
  { name: "X-Ray Dorsal Spine",                price: 400,  category: "X-Ray" },
  { name: "X-Ray Elbow",                       price: 300,  category: "X-Ray" },
  { name: "X-Ray Forearm",                     price: 300,  category: "X-Ray" },
  { name: "X-Ray Leg",                         price: 300,  category: "X-Ray" },
  { name: "X-Ray Mandible",                    price: 400,  category: "X-Ray" },
  { name: "X-Ray Mastoid",                     price: 400,  category: "X-Ray" },
  { name: "X-Ray Nasal Bones",                 price: 300,  category: "X-Ray" },
  { name: "X-Ray Calcaneum",                   price: 300,  category: "X-Ray" },
  { name: "X-Ray Abdomen (Erect)",             price: 400,  category: "X-Ray" },
  // Blood Test
  { name: "Complete Blood Count (CBC)",        price: 250,  category: "Blood Test" },
  { name: "Blood Sugar – Fasting",             price: 80,   category: "Blood Test" },
  { name: "Blood Sugar – PP",                  price: 80,   category: "Blood Test" },
  { name: "HbA1c",                             price: 350,  category: "Blood Test" },
  { name: "Widal Test",                        price: 200,  category: "Blood Test" },
  { name: "Dengue NS1 Ag",                     price: 800,  category: "Blood Test" },
  // Pathology
  { name: "Thyroid Profile (T3, T4, TSH)",     price: 600,  category: "Pathology" },
  { name: "Liver Function Test (LFT)",         price: 700,  category: "Pathology" },
  { name: "Kidney Function Test (KFT)",        price: 600,  category: "Pathology" },
  { name: "Lipid Profile",                     price: 500,  category: "Pathology" },
  { name: "Urine Routine",                     price: 100,  category: "Pathology" },
  { name: "Serum Creatinine",                  price: 150,  category: "Pathology" },
  // Cardiology
  { name: "ECG (12 Lead)",                     price: 200,  category: "Cardiology" },
  { name: "Echocardiography (ECHO)",           price: 2000, category: "Cardiology" },
  { name: "Stress Test (TMT)",                 price: 2500, category: "Cardiology" },
  { name: "Holter Monitor (24hr)",             price: 3000, category: "Cardiology" },
]

export const CATALOGUE_CATEGORY_MAP: Record<string, string> = Object.fromEntries(
  STUDY_CATALOGUE.map((s) => [s.name, s.category])
)

export const CATALOGUE_PRICE_MAP: Record<string, number> = Object.fromEntries(
  STUDY_CATALOGUE.map((s) => [s.name, s.price])
)

export function autoCategory(name: string): string {
  if (CATALOGUE_CATEGORY_MAP[name]) return CATALOGUE_CATEGORY_MAP[name]
  const s = name.toLowerCase()
  if (/usg|sonograph|doppler|obstetric|trimester|\btvs\b|fnac|carotid|venous|arterial|follicular|parotid|scrotum/.test(s)) return "Sonography"
  if (/\bmri\b|\bmra\b/.test(s))                                                                     return "MRI"
  if (/\bct\b|hrct/.test(s))                                                                         return "CT Scan"
  if (/x-ray|x ray|\bxray\b/.test(s))                                                                return "X-Ray"
  if (/\becg\b|echo|holter|stress test|\btmt\b|cardiac|cardio/.test(s))                              return "Cardiology"
  if (/blood|cbc|hba1c|sugar|widal|dengue|haemoglobin|hemoglobin|platelet|\brbc\b|\bwbc\b/.test(s))  return "Blood Test"
  if (/thyroid|liver|kidney|lipid|urine|creatinine|biopsy|culture|smear|serum|electrolyte|stool|sputum/.test(s)) return "Pathology"
  return "Other"
}
