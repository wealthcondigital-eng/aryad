import mongoose, { Schema, Model } from "mongoose"

/**
 * Register a Mongoose model, replacing any copy left over from an earlier
 * evaluation of the module that defines it.
 *
 * The usual Next.js pattern — `mongoose.models.X || mongoose.model(X, schema)`
 * — exists because the dev server evaluates a module more than once and
 * Mongoose throws on re-registering a name. But it keeps the FIRST schema the
 * process ever saw. Edit a schema while the server is running and the running
 * process carries on with the old one: strict mode strips the new field from
 * every write, the request still answers 200, and the change simply doesn't
 * happen. That failure is invisible — no error anywhere, the value just isn't
 * there on the next read.
 *
 * Re-registering keeps the model in step with the file it is defined in. A
 * module is only re-evaluated when it changes, so this costs nothing in
 * production and removes a whole class of "I changed the schema and nothing
 * happened" in development.
 *
 * The return type mirrors what `mongoose.models.X || …` resolved to before —
 * `Model<any>`. The app's query call sites lean on that looseness in a few dozen
 * places. Tightening the models is worth doing, but not as a side effect of
 * this: returning the precise `Model<T>` surfaces unrelated type errors right
 * across the app.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineModel<T>(name: string, schema: Schema<T>): Model<any> {
  if (mongoose.models[name]) mongoose.deleteModel(name)
  return mongoose.model<T>(name, schema)
}
