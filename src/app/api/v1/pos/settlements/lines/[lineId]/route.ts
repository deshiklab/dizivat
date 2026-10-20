import { patchPosSettlementLine } from "../../../../_r10"
export const PATCH = (req: Request, { params }: { params: Promise<{ lineId: string }> }) =>
  params.then((p) => patchPosSettlementLine(req, "", p.lineId))
