﻿
angular.module('classRoomApp', [])
.controller('classRoomController', ['$scope', function ($scope) {
    $scope.data = {};
    $scope.data.Users = [];

    $scope.Mode = 'idle';

    $scope.myName = "asddsadsa";
    $scope.Username = "Test";

    var connectionManager = WebRtcDemo.ConnectionManager;

    // Connection Manager Callbacks
    var _callbacks = {
        onReadyForStream: function (connection) {
            // The connection manager needs our stream
            // todo: not sure I like this
            connection.addStream(_mediaStream);
        },
        onStreamAdded: function (connection, event) {
            console.log('binding remote stream to the partner window');

            // Bind the remote stream to the partner window
            var otherVideo = document.querySelector('.video.partner');
            attachMediaStream(otherVideo, event.stream); // from adapter.js
        },
        onStreamRemoved: function (connection, streamId) {
            // todo: proper stream removal.  right now we are only set up for one-on-one which is why this works.
            console.log('removing remote stream from partner window');

            // Clear out the partner window
            var otherVideo = document.querySelector('.video.partner');
            otherVideo.src = '';
        }
    };

    function checkRTC() {
        // Show warning if WebRTC support is not detected
        if (webrtcDetectedBrowser == null) {
            console.log('Your browser doesnt appear to support WebRTC.');
            $('.browser-warning').show();
        }
        // Then proceed to the next step, gathering username
        _getUsername();
    }

    function _getUsername() {
        alertify.prompt("What is your name?", function (e, username) {
            if (e == false || username == '') {
                username = 'User ' + Math.floor((Math.random() * 10000) + 1);
                alertify.success('You really need a username, so we will call you... ' + username);
            }

            // proceed to next step, get media access and start up our connection
            _startSession(username);
        }, '');
    }

    function _startSession(username) {
        $scope.$apply(function () {
            $scope.Username = username; // Set the selected username in the UI
            $scope.Loading = true; // Turn on the loading indicator
        });
        

        // Ask the user for permissions to access the webcam and mic
        getUserMedia(
            {
                // Permissions to request
                video: true,
                audio: true
            },
            function (stream) { // succcess callback gives us a media stream
                $('.instructions').hide();

                // Now we have everything we need for interaction, so fire up SignalR
                _connect(username, function (hub) {
                    // tell the $scope our conn id, so we can be treated like the special person we are.
                    $scope.MyConnectionId = hub.connection.id;

                    // Initialize our client signal manager, giving it a signaler (the SignalR hub) and some callbacks
                    console.log('initializing connection manager');
                    connectionManager.initialize(hub.server, _callbacks.onReadyForStream, _callbacks.onStreamAdded, _callbacks.onStreamRemoved);

                    // Store off the stream reference so we can share it later
                    _mediaStream = stream;

                    // Load the stream into a video element so it starts playing in the UI
                    console.log('playing my local video feed');
                    var videoElement = document.querySelector('.video.mine');
                    attachMediaStream(videoElement, _mediaStream);

                    // Hook up the UI
                    _attachUiHandlers();

                    $scope.$apply(function () {
                        $scope.Loading = false;
                    });
                    
                }, function (event) {
                    alertify.alert('<h4>Failed SignalR Connection</h4> We were not able to connect you to the signaling server.<br/><br/>Error: ' + JSON.stringify(event));
                    $scope.$apply(function () {
                        $scope.Loading = false;
                    });
                   
                });
            },
            function (error) { // error callback
                alertify.alert('<h4>Failed to get hardware access!</h4> Do you have another browser type open and using your cam/mic?<br/><br/>You were not connected to the server, because I didn\'t code to make browsers without media access work well. <br/><br/>Actual Error: ' + JSON.stringify(error));
                $scope.$apply(function () {
                    $scope.Loading = false;
                });
            }
        );
    }

    function _attachUiHandlers() {
        // Add click handler to users in the "Users" pane
        $('.user').live('click', function () {
            // Find the target user's SignalR client id
            var targetConnectionId = $(this).attr('data-cid');

            // Make sure we are in a state where we can make a call
            if ($scope.Mode !== 'idle') {
                alertify.error('Sorry, you are already in a call.  Conferencing is not yet implemented.');
                return;
            }

            // Then make sure we aren't calling ourselves.
            if (targetConnectionId != $scope.MyConnectionId) {
                // Initiate a call
                _hub.server.callUser(targetConnectionId);

                // UI in calling mode
                $scope.$apply(function () {
                    $scope.Mode = 'calling';
                });
                
            } else {
                alertify.error("Ah, nope.  Can't call yourself.");
            }
        });

        // Add handler for the hangup button
        $('.hangup').click(function () {
            // Only allow hangup if we are not idle
            if ($scope.Mode != 'idle') {
                _hub.server.hangUp();
                connectionManager.closeAllConnections();
                $scope.$apply(function () {
                    $scope.Mode = 'idle';
                });
                
            }
        });
    }

    function _connect(username, onSuccess, onFailure) {
        // Set Up SignalR Signaler
        var hub = $.connection.webRtcHub;
        $.support.cors = true;
        $.connection.hub.url = '/signalr/hubs';
        $.connection.hub.start()
            .done(function () {
                console.log('connected to SignalR hub... connection id: ' + _hub.connection.id);

                // Tell the hub what our username is
                hub.server.join(username);

                if (onSuccess) {
                    onSuccess(hub);
                }
            })
            .fail(function (event) {
                if (onFailure) {
                    onFailure(event);
                }
            });

        // Setup client SignalR operations
        _setupHubCallbacks(hub);
        _hub = hub;
    }

    function _setupHubCallbacks(hub) {
        // Hub Callback: Incoming Call
        hub.client.incomingCall = function (callingUser) {
            console.log('incoming call from: ' + JSON.stringify(callingUser));

            // Ask if we want to talk
            alertify.confirm(callingUser.Username + ' is calling.  Do you want to chat?', function (e) {
                if (e) {
                    // I want to chat
                    hub.server.answerCall(true, callingUser.ConnectionId);

                    // So lets go into call mode on the UI
                    $scope.$apply(function () {
                        $scope.Mode = 'incall';
                    });
                   
                } else {
                    // Go away, I don't want to chat with you
                    hub.server.answerCall(false, callingUser.ConnectionId);
                }
            });
        };

        // Hub Callback: Call Accepted
        hub.client.callAccepted = function (acceptingUser) {
            console.log('call accepted from: ' + JSON.stringify(acceptingUser) + '.  Initiating WebRTC call and offering my stream up...');

            // Callee accepted our call, let's send them an offer with our video stream
            connectionManager.initiateOffer(acceptingUser.ConnectionId, _mediaStream);

            // Set UI into call mode
            $scope.$apply(function () {
                $scope.Mode = 'incall';
            });
            
        };

        // Hub Callback: Call Declined
        hub.client.callDeclined = function (decliningConnectionId, reason) {
            console.log('call declined from: ' + decliningConnectionId);

            // Let the user know that the callee declined to talk
            alertify.error(reason);

            // Back to an idle UI
            $scope.$apply(function () {
                $scope.Mode = 'idle';
            });
           
        };

        // Hub Callback: Call Ended
        hub.client.callEnded = function (connectionId, reason) {
            console.log('call with ' + connectionId + ' has ended: ' + reason);

            // Let the user know why the server says the call is over
            alertify.error(reason);

            // Close the WebRTC connection
            connectionManager.closeConnection(connectionId);

            // Set the UI back into idle mode
            $scope.$apply(function () {
                $scope.Mode = 'idle';
            });
           
        };

        // Hub Callback: Update User List
        hub.client.updateUserList = function (userList) {
            $scope.$apply(function () {
                $scope.data.Users = userList;
            });
            
        };

        // Hub Callback: WebRTC Signal Received
        hub.client.receiveSignal = function (callingUser, data) {
            connectionManager.newSignal(callingUser.ConnectionId, data);
        };
    }

    // start to load class room
        checkRTC();
    
}]);
