import { closePosShiftRoute } from "../../../../_r10"
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => params.then((p) => closePosShiftRoute(req, p.id))
