export interface ServerToClientEvents  {
    someoneStatusChange: (param:{username:string,isOnline:boolean})=>void,
    toRoomClient:(msg:ServerToUserMsg)=>void;
}
export interface ClientToServerEvents  {
    joinRoom: (groupIds: string[])=>void,
    msgToServer: (msg: userToServerMsg)=>void
}
export interface InterServerEvents  {
    disconnect: ()=>void;
    error: (err:any) => void;
}
export interface SocketData {
    username:string,
    groups: any[]
}
export type userToServerMsg = {
    avatar:string,room:string,msg:string,time:Date
}
export type ServerToUserMsg = userToServerMsg & {
    username:string
}