import * as React from 'react';
import { Text, View, TouchableOpacity } from 'react-native';
import { Header, Icon, Divider } from 'react-native-elements';
import AddIcon from '../../assets/images/SVG/Add.svg';

import { themeColor } from '../../utils/ThemeUtils';

interface ContactsSettingsProps {
    navigation: any;
}

export default class ContactsSettings extends React.Component<ContactsSettingsProps> {
    render() {
        const { navigation } = this.props;
        const BackButton = () => (
            <Icon
                name="arrow-back"
                onPress={() => {
                    navigation.navigate('Settings', {
                        refresh: true
                    });
                }}
                color={themeColor('text')}
                underlayColor="transparent"
            />
        );
        const Add = ({ navigation }: { navigation: any }) => (
            <TouchableOpacity
                onPress={() => navigation.navigate('AddContacts')}
            >
                <AddIcon
                    fill={themeColor('text')}
                    width="25"
                    height="25"
                    style={{ alignSelf: 'center' }}
                />
            </TouchableOpacity>
        );
        return (
            <View
                style={{
                    flex: 1,
                    backgroundColor: themeColor('background')
                }}
            >
                <Header
                    leftComponent={<BackButton />}
                    backgroundColor={themeColor('background')}
                    containerStyle={{
                        borderBottomWidth: 0
                    }}
                    rightComponent={<Add navigation={navigation} />}
                />
                <View>
                    <Divider
                        orientation="horizontal"
                        style={{ marginTop: 14 }}
                    />
                    <View style={{ margin: 18 }}>
                        <Text
                            style={{ color: themeColor('text'), fontSize: 16 }}
                        >
                            Search
                        </Text>
                    </View>
                    <Divider orientation="horizontal" />
                    <View style={{ margin: 18 }}>
                        <Text style={{ fontSize: 18 }}>Contacts (420)</Text>
                    </View>
                </View>
            </View>
        );
    }
}
