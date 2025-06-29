import os
import json
from shapely.geometry import shape
import geopandas as gpd

# Tüm JSON dosyalarının olduğu klasör
folder_path = "C:/Users/Baleo/Desktop/script/github/spider-map/preprocessing"  # kendi klasör yolunu yaz

features = []

for file in os.listdir(folder_path):
    if file.endswith(".json"):
        with open(os.path.join(folder_path, file), "r", encoding="utf-8") as f:
            data = json.load(f)
            
            # TKGM verisi GeoJSON standardında olabilir veya değil, kontrol edelim
            if "features" in data:  # zaten GeoJSON'sa direkt al
                features.extend(data["features"])
            elif "geometry" in data and "properties" in data:
                features.append({
                    "type": "Feature",
                    "geometry": data["geometry"],
                    "properties": data["properties"]
                })
            else:
                print(f"⚠️ Beklenmeyen format: {file}")

# GeoJSON formatı
geojson_output = {
    "type": "FeatureCollection",
    "features": features
}

# Çıktıyı yaz
output_path = "C:/Users/Baleo/Desktop/parseller.geojson"  # çıktı konumu
with open(output_path, "w", encoding="utf-8") as out_file:
    json.dump(geojson_output, out_file, ensure_ascii=False, indent=2)

print("✅ parseller.geojson başarıyla oluşturuldu.")
