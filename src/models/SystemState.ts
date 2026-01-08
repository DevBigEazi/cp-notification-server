import mongoose, { Schema, Document } from "mongoose";

export interface ISystemState extends Document {
    key: string;
    value: any;
    updatedAt: Date;
}

const SystemStateSchema = new Schema<ISystemState>({
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true });

export const SystemState = mongoose.model<ISystemState>("SystemState", SystemStateSchema);
export default SystemState;
