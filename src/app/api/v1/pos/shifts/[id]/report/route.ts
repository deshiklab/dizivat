import { getPosShiftReport } from "../../../../_r10"
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) => params.then((p) => getPosShiftReport(req, p.id))
