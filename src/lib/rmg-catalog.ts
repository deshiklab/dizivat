/**
 * R6.2 — RMG starter catalogue: common garment inputs, accessories, packaging and finished garments with their
 * HS codes (Bangladesh Customs Tariff, 8 digits), so a garment or accessories company can set up items in one step
 * (Inventory › Items › Import, or Master data › Data import). VAT defaults to the standard 15 %; exports and deemed
 * exports are zero-rated on the invoice, not on the item. Check each code against the tariff of the current
 * fiscal year before use — the catalogue is a starting point, not a classification ruling.
 */
import type { ItemGroup } from "./types"

export interface CatalogItem { sku: string; name: string; hsCode: string; group: ItemGroup; unit: string; category: "packaging" | "trims" | "labels" | "fabric" | "garment" }

export const RMG_CATALOG: CatalogItem[] = [
  // packaging (deemed exporters: carton / poly / flexible packaging makers)
  { sku: "RMG-CTN-5P", name: "Corrugated export carton, 5-ply", hsCode: "48191000", group: "Finished Goods", unit: "Pcs", category: "packaging" },
  { sku: "RMG-CTN-3P", name: "Corrugated inner carton, 3-ply", hsCode: "48191000", group: "Finished Goods", unit: "Pcs", category: "packaging" },
  { sku: "RMG-BOX-FLD", name: "Folding gift box, duplex board", hsCode: "48192000", group: "Finished Goods", unit: "Pcs", category: "packaging" },
  { sku: "RMG-PLY-LD", name: "Poly bag, LDPE self-adhesive flap", hsCode: "39232100", group: "Finished Goods", unit: "Pcs", category: "packaging" },
  { sku: "RMG-PLY-PP", name: "Poly bag, PP printed with warning text", hsCode: "39232990", group: "Finished Goods", unit: "Pcs", category: "packaging" },
  { sku: "RMG-FLX-LAM", name: "Printed laminated film (flexible packaging)", hsCode: "39204990", group: "Finished Goods", unit: "Kg", category: "packaging" },
  { sku: "RMG-TAPE-BOPP", name: "BOPP carton sealing tape, 48 mm", hsCode: "39191000", group: "Packing Materials", unit: "Roll", category: "packaging" },
  { sku: "RMG-HGR-PL", name: "Plastic hanger with metal hook", hsCode: "39269099", group: "Finished Goods", unit: "Pcs", category: "trims" },
  // labels & tags
  { sku: "RMG-LBL-WVN", name: "Woven main label", hsCode: "58071000", group: "Finished Goods", unit: "Pcs", category: "labels" },
  { sku: "RMG-LBL-CARE", name: "Printed satin care label", hsCode: "58079000", group: "Finished Goods", unit: "Pcs", category: "labels" },
  { sku: "RMG-TAG-HANG", name: "Paper hang tag, printed", hsCode: "48211000", group: "Finished Goods", unit: "Pcs", category: "labels" },
  { sku: "RMG-LBL-BAR", name: "Barcode / price sticker, self-adhesive", hsCode: "48211000", group: "Finished Goods", unit: "Pcs", category: "labels" },
  { sku: "RMG-LBL-HTL", name: "Heat-transfer label", hsCode: "49089000", group: "Finished Goods", unit: "Pcs", category: "labels" },
  // trims
  { sku: "RMG-BTN-PL", name: "Polyester button, 4-hole", hsCode: "96062100", group: "Raw Material", unit: "Pcs", category: "trims" },
  { sku: "RMG-BTN-MT", name: "Metal shank button (denim)", hsCode: "96062200", group: "Raw Material", unit: "Pcs", category: "trims" },
  { sku: "RMG-SNAP", name: "Snap fastener / press stud", hsCode: "96061000", group: "Raw Material", unit: "Pcs", category: "trims" },
  { sku: "RMG-ZIP-MT", name: "Zip fastener, metal teeth", hsCode: "96071100", group: "Raw Material", unit: "Pcs", category: "trims" },
  { sku: "RMG-ZIP-NY", name: "Zip fastener, nylon coil", hsCode: "96071900", group: "Raw Material", unit: "Pcs", category: "trims" },
  { sku: "RMG-THR-PS", name: "Sewing thread, spun polyester (cone)", hsCode: "55081000", group: "Raw Material", unit: "Pcs", category: "trims" },
  { sku: "RMG-ELS-TAPE", name: "Elastic tape, woven", hsCode: "58062000", group: "Raw Material", unit: "Meter", category: "trims" },
  { sku: "RMG-TWL-TAPE", name: "Cotton twill tape", hsCode: "58063100", group: "Raw Material", unit: "Meter", category: "trims" },
  { sku: "RMG-HOOK-LOOP", name: "Hook-and-loop tape", hsCode: "58061000", group: "Raw Material", unit: "Meter", category: "trims" },
  { sku: "RMG-CORD", name: "Drawcord, braided polyester", hsCode: "56090000", group: "Raw Material", unit: "Meter", category: "trims" },
  { sku: "RMG-INTL-FUS", name: "Fusible interlining", hsCode: "59039000", group: "Raw Material", unit: "Meter", category: "trims" },
  // fabric & yarn (composite / direct exporters)
  { sku: "RMG-YRN-30S", name: "Cotton yarn, carded 30s Ne", hsCode: "52051300", group: "Raw Material", unit: "Kg", category: "fabric" },
  { sku: "RMG-FAB-KNIT", name: "Single jersey knit fabric, cotton, dyed", hsCode: "60062200", group: "Raw Material", unit: "Kg", category: "fabric" },
  { sku: "RMG-FAB-DNM", name: "Denim fabric, cotton, 12 oz", hsCode: "52094200", group: "Raw Material", unit: "Meter", category: "fabric" },
  // finished garments (direct exporters)
  { sku: "RMG-GMT-TEE", name: "T-shirt, cotton knit", hsCode: "61091000", group: "Finished Goods", unit: "Pcs", category: "garment" },
  { sku: "RMG-GMT-POLO", name: "Polo shirt, men's, cotton knit", hsCode: "61051000", group: "Finished Goods", unit: "Pcs", category: "garment" },
  { sku: "RMG-GMT-SWT", name: "Sweater / pullover, cotton", hsCode: "61102000", group: "Finished Goods", unit: "Pcs", category: "garment" },
  { sku: "RMG-GMT-TRS", name: "Trousers, men's, cotton woven (denim)", hsCode: "62034200", group: "Finished Goods", unit: "Pcs", category: "garment" },
]

/** Catalogue entries as import rows (same columns as the item template). */
export const catalogRows = (picked: CatalogItem[]) => picked.map((c) => ({
  name: c.name, sku: c.sku, hsCode: c.hsCode, group: c.group, unit: c.unit, purchasePrice: 0, salePrice: 0, vatRate: 15, sdRate: 0, reorderLevel: 0,
}))
