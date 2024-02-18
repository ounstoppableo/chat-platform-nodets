import { Group, UserInfo } from '../userApi/userApi';

export interface ServerToClientEvents {
    someoneStatusChange: (param: { username: string, isOnline: boolean }) => void,
    toRoomClient: (msg: ServerToUserMsg) => void;
    sbLikeMsg: (msg: { success: boolean, likes: number, msgId: number, room: string, type: 'like' }) => void;
    cancelSbLikeMsg: (msg: { success: boolean, likes: number, msgId: number, room: string, type: 'cancelLike' }) => void;
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
    addGroup:(msg:{userInfo?:UserInfo,groupId:string,groupInfo?:Group})=>void;
    delGroup:(msg:{success:boolean,groupInfo:Group})=>void;
    exitGroup:(msg:{success:boolean,groupInfo:Group,username:string})=>void;
    editGroupName:(msg:{success:boolean,groupInfo:Group,newName:string})=>void;
    kickOutGroup:(msg:{success:boolean,groupInfo:Group,kickOutUsername:string})=>void;
    clientError: (err: { msg: string }) => void;
}
export interface ClientToServerEvents {
    joinRoom: (groupIds: any[]|string) => void,
    msgToServer: (msg: userToServerMsg) => void,
    likeSbMsg: (msg: { username: string, msgId: number, likes: number, room: string; }) => void;
    cancelLikeSbMsg: (msg: { username: string, msgId: number, likes: number, room: string; }) => void;
    dislikeSbMsg: (msg: {
        username: string;
        msgId: number;
        dislikes: number;
        room: string;
    }) => void;
    cancelDislikeSbMsg: (msg: {
        username: string;
        msgId: number;
        dislikes: number;
        room: string;
    }) => void;
    p2pChat:(msg: Omit<userToServerMsg,'room'|'avatar'>&{fromName:string;toName:string,fromAvatar:string,toAvatar:string})=>void;
    delGroup:(msg:Group)=>void;
    exitGroup:(msg:Group)=>void;
    editGroupName:(msg:{group:Group,newName:string})=>void;
    kickOutGroup:(msg:{group:Group,kickOutUsername:string})=>void
}
export interface InterServerEvents {
    disconnect: () => void;
    error: (err: any) => void;
}
export interface SocketData {
    username: string,
    groups: any[]
}
export type userToServerMsg = {
    avatar: string, room: string, msg: string, time: Date,id?:number,likes?:number,dislikes?:number,atMembers?: string[],forMsg?:string
}
export type ServerToUserMsg = userToServerMsg & {
    username: string
}
export type TotalMsg = {
    [key: string]: ServerToUserMsg[];
}