export interface ServerToClientEvents  {
    someoneStatusChange: (param:{username:string,isOnline:boolean})=>void,
    toRoomClient:(msg:ServerToUserMsg)=>void;
    sbLikeMsg: (msg:{success:boolean,likes:number,msgId:number,room:string ,type:'like'}) => void;
    cancelSbLikeMsg: (msg:{success:boolean,likes:number,msgId:number,room:string,type:'cancelLike'}) => void;
    sbDislikeMsg: (msg: {
        success: boolean;
        dislikes: number;
        msgId: number;
        room: string;
      }) => void;
    cancelSbDislikeMsg: (msg: {
      success: boolean;
      dislikes: number;
      msgId: number;
      room: string;
    }) => void;
}
export interface ClientToServerEvents  {
    joinRoom: (groupIds: string[])=>void,
    msgToServer: (msg: userToServerMsg)=>void,
    likeSbMsg: (msg:{username:string,msgId:number, likes: number, room: string; })=>void;
    cancelLikeSbMsg: (msg:{username:string,msgId:number, likes: number, room: string; })=>void;
    dislikeSbMsg: (msg: {
        username: string;
        msgId: number;
        dislikes: number;
        room: string;
      }) => void;
      cancelDislikeSbMsg:(msg: {
        username: string;
        msgId: number;
        dislikes: number;
        room: string;
      }) => void;
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
    avatar:string,room:string,msg:string,time:Date,timestamp:number,likes:number,dislikes:number,id:number
}
export type ServerToUserMsg = userToServerMsg & {
    username:string
}
export type TotalMsg = {
    [key: string]: ServerToUserMsg[];
}