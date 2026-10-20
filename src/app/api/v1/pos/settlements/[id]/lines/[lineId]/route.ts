import { patchPosSettlementLine } from "../../../../../_r10"
export const PATCH = (req: Request, { params }: { params: Promise<{ id: string; lineId: string }> }) =>
  params.then((p) => patchPosSettlementLine(req, p.id, p.lineId))
