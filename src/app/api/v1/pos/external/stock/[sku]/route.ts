import { getExternalPosStock } from "../../../../_r10"

export const GET = async (req: Request, { params }: { params: Promise<{ sku: string }> }) =>
  getExternalPosStock(req, decodeURIComponent((await params).sku))
