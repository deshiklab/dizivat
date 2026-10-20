import { putPosRegister } from "../../../_r10"
export const PUT = (req: Request, { params }: { params: Promise<{ id: string }> }) => params.then((p) => putPosRegister(req, p.id))
